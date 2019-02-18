import {
    CacheControl,
    Headers,
    HttpMethod,
    ICachePolicyFields,
    ICachePolicyObject,
    IRequest,
    IRequestCacheControl,
    IRequestHeaders,
    IResponse,
    IResponseCacheControl,
    IResponseHeaders,
} from './types';

export = class CachePolicy implements ICachePolicyFields {
    public static fromObject(obj: ICachePolicyObject): CachePolicy {
        if (!obj || obj.v !== 1) {
            throw Error('Invalid serialization');
        }

        const policy: ICachePolicyFields = {
            cacheHeuristic: obj.ch,
            host: obj.h,
            immutableMinTtl: obj.imm == null ? defaultImmutableMinTtl : obj.imm,
            isShared: obj.sh,
            method: obj.m,
            noAuthorization: obj.a,
            reqHeaders: obj.reqh,
            reqcc: obj.reqcc,
            resHeaders: obj.resh,
            rescc: obj.rescc,
            responseTime: obj.t,
            status: obj.st,
            url: obj.u,
        };

        return Object.assign(Object.create(CachePolicy.prototype), policy);
    }

    public readonly cacheHeuristic: number;
    public readonly host?: string;
    public readonly immutableMinTtl: number;
    public readonly isShared: boolean;
    public readonly method: HttpMethod;
    public readonly noAuthorization: boolean;
    public readonly reqHeaders?: IRequestHeaders;
    public readonly reqcc: IRequestCacheControl;
    public readonly resHeaders: IResponseHeaders;
    public readonly rescc: IResponseCacheControl;
    public readonly responseTime: number;
    public readonly status: number;
    public readonly url?: string;

    private readonly trustServerDate: boolean;

    constructor(
        req: IRequest,
        res?: IResponse,
        {
            shared,
            cacheHeuristic,
            immutableMinTimeToLive,
            ignoreCargoCult,
            trustServerDate,
        }: {
            shared?: boolean;
            cacheHeuristic?: number;
            immutableMinTimeToLive?: number;
            status?: number;
            ignoreCargoCult?: boolean;
            trustServerDate?: boolean;
        } = {}
    ) {
        if (!res || !res.headers) {
            throw Error('Response headers missing');
        }

        assertRequestHasHeaders(req);

        const reqHeaders = req.headers as IRequestHeaders;

        this.responseTime = Date.now();
        this.isShared = shared !== false;
        this.trustServerDate = trustServerDate == null ? true : trustServerDate;
        // 10% matches IE
        this.cacheHeuristic = cacheHeuristic == null ? 0.1 : cacheHeuristic;
        this.immutableMinTtl =
            immutableMinTimeToLive == null
                ? defaultImmutableMinTtl
                : immutableMinTimeToLive;

        this.status = res.status == null ? 200 : res.status;
        this.resHeaders = res.headers;
        this.rescc = parseCacheControl(res.headers['cache-control']);
        this.method = req.method == null ? 'GET' : req.method;
        this.url = req.url;
        this.host = reqHeaders.host;
        this.noAuthorization = !reqHeaders.authorization;
        if (res.headers.vary) {
            // Don't keep all request headers if they won't be used
            this.reqHeaders = reqHeaders;
        }
        this.reqcc = parseCacheControl(reqHeaders['cache-control']);

        /**
         * Assume that if someone { uses } legacy, non-standard uncecessary
         * options they don't understand caching, so there's no point stricly
         * adhering to the blindly copy&pasted directives.
         */
        if (
            ignoreCargoCult &&
            this.rescc['pre-check'] != null &&
            this.rescc['post-check'] != null
        ) {
            delete this.rescc['pre-check'];
            delete this.rescc['post-check'];
            delete this.rescc['no-cache'];
            delete this.rescc['no-store'];
            delete this.rescc['must-revalidate'];
            this.resHeaders = {
                ...this.resHeaders,
                'cache-control': formatCacheControl(this.rescc),
            };
            delete this.resHeaders.expires;
            delete this.resHeaders.pragma;
        }

        /**
         * When the Cache-Control header field is not present in a request,
         * caches MUST consider the no-cache request pragma-directive as having
         * the same effect as if "Cache-Control: no-cache" were present
         * (see Section 5.2.1).
         */
        if (
            res.headers['cache-control'] == null &&
            res.headers.pragma != null &&
            /no-cache/.test(res.headers.pragma)
        ) {
            this.rescc['no-cache'] = true;
        }
    }

    public storable() {
        /**
         * The "no-store" request directive indicates that a cache MUST NOT
         * store any part of either this request or any response to it.
         */
        return !!(
            !this.reqcc['no-store'] &&
            /*
             * A cache MUST NOT store a response to any request, unless:
             * - The request method is understood by the cache and defined as
             *   being cacheable, and
             */
            (this.method === 'GET' ||
                this.method === 'HEAD' ||
                (this.method === 'POST' && this.hasExplicitExpiration())) &&
            // the response status code is understood by the cache, and
            understoodStatuses.indexOf(this.status) !== -1 &&
            /*
             * - the "no-store" cache directive does not appear in request or
             *   response header fields, and
             */
            !this.rescc['no-store'] &&
            /*
             * - the "private" response directive does not appear in the
                 response if the cache is shared, and
             */
            (!this.isShared || !this.rescc.private) &&
            /**
             * - the Authorization header field does not appear in the request,
             *   if the cache is shared,
             */
            (!this.isShared ||
                this.noAuthorization ||
                this.allowsStoringAuthenticated()) &&
            /**
             * the response either:
             * - contains an Expires header field, or
             */
            (this.resHeaders.expires ||
                /**
                 * - contains a max-age response directive, or
                 * - contains a s-maxage response directive and the cache is shared, or
                 * - contains a public response directive.
                 */
                this.rescc.public ||
                this.rescc['max-age'] ||
                this.rescc['s-maxage'] ||
                // has a status code that is defined as cacheable by default
                defaultCacheableStatusCodes.indexOf(this.status) !== -1)
        );
    }

    public satisfiesWithoutRevalidation(req: IRequest) {
        assertRequestHasHeaders(req);

        const reqHeaders = req.headers as IRequestHeaders;

        /**
         * When presented with a request, a cache MUST NOT reuse a stored
         * response, unless:
         * - the presented request does not contain the no-cache pragma (Section
         *   5.4), nor the no-cache cache directive,
         * - unless the stored response is successfully validated (Section 4.3),
         *   and
         */
        const requestCC = parseCacheControl(
            reqHeaders['cache-control']
        ) as IRequestCacheControl;

        if (
            requestCC['no-cache'] != null ||
            (reqHeaders.pragma != null && /no-cache/.test(reqHeaders.pragma))
        ) {
            return false;
        }

        if (
            requestCC['max-age'] &&
            this.age() > parseInt(requestCC['max-age'], 10)
        ) {
            return false;
        }

        if (
            requestCC['min-fresh'] &&
            this.timeToLive() < 1000 * parseInt(requestCC['min-fresh'], 10)
        ) {
            return false;
        }

        /**
         * the stored response is either:
         * - fresh,
         * - or allowed to be served stale
         */
        if (this.stale()) {
            const allowsStale =
                requestCC['max-stale'] &&
                !this.rescc['must-revalidate'] &&
                (requestCC['max-stale'] === true ||
                    parseInt(requestCC['max-stale'], 10) >
                        this.age() - this.maxAge());
            if (!allowsStale) {
                return false;
            }
        }

        return this.requestMatches(req, false);
    }

    public responseHeaders() {
        const headers = this.copyWithoutHopByHopHeaders(this.resHeaders);
        const age = this.age();

        /**
         * A cache SHOULD generate 113 warning if it heuristically chose a
         * freshness lifetime greater than 24 hours and the response's age is
         * greater than 24 hours.
         */
        if (
            age > 3600 * 24 &&
            !this.hasExplicitExpiration() &&
            this.maxAge() > 3600 * 24
        ) {
            const warning = headers.warning ? `${headers.warning}, ` : '';
            headers.warning = `${warning}113 - "rfc7234 5.5.4"`;
        }
        headers.age = `${Math.round(age)}`;
        headers.date = new Date(Date.now()).toUTCString();
        return headers;
    }

    /**
     * Value of the Date response header or current time if Date was deemed
     * invalid
     *
     * @return timestamp
     */
    public date() {
        if (this.trustServerDate) {
            return this.serverDate();
        }
        return this.responseTime;
    }

    /**
     * Value of the Age header, in seconds, updated for the current time. May
     * be fractional.
     *
     * @return Number
     */
    public age() {
        let age = Math.max(0, (this.responseTime - this.date()) / 1000);
        if (this.resHeaders.age) {
            const ageValue = this.ageValue();
            if (ageValue > age) {
                age = ageValue;
            }
        }

        const residentTime = (Date.now() - this.responseTime) / 1000;
        return age + residentTime;
    }

    /**
     * Value of applicable max-age (or heuristic equivalent) in seconds. This
     * counts since response's `Date`.
     *
     * For an up-to-date value, see `timeToLive()`.
     *
     * @return Number
     */
    public maxAge() {
        if (!this.storable() || this.rescc['no-cache']) {
            return 0;
        }

        /**
         * Shared responses with cookies are cacheable according to the RFC,
         * but IMHO it'd be unwise to do so by default so this implementation
         * requires explicit opt-in via public header
         */
        if (
            this.isShared &&
            (this.resHeaders['set-cookie'] &&
                !this.rescc.public &&
                !this.rescc.immutable)
        ) {
            return 0;
        }

        if (this.resHeaders.vary === '*') {
            return 0;
        }

        if (this.isShared) {
            if (this.rescc['proxy-revalidate']) {
                return 0;
            }
            /**
             * if a response includes the s-maxage directive, a shared cache
             * recipient MUST ignore the Expires field.
             */
            if (this.rescc['s-maxage']) {
                return parseInt(this.rescc['s-maxage'], 10);
            }
        }

        /**
         * If a response includes a Cache-Control field with the max-age
         * directive, a recipient MUST ignore the Expires field.
         */
        if (this.rescc['max-age']) {
            return parseInt(this.rescc['max-age'], 10);
        }

        const defaultMinTtl = this.rescc.immutable ? this.immutableMinTtl : 0;

        const dateValue = this.serverDate();
        if (this.resHeaders.expires) {
            const expires = Date.parse(this.resHeaders.expires);
            /**
             * A cache recipient MUST interpret invalid date formats, especially
             * the value "0", as representing a time in the past (i.e., "already
             * expired").
             */
            if (Number.isNaN(expires) || expires < dateValue) {
                return 0;
            }
            return Math.max(defaultMinTtl, (expires - dateValue) / 1000);
        }

        if (this.resHeaders['last-modified'] != null) {
            const lastModified = Date.parse(this.resHeaders['last-modified']);
            if (isFinite(lastModified) && dateValue > lastModified) {
                return Math.max(
                    defaultMinTtl,
                    ((dateValue - lastModified) / 1000) * this.cacheHeuristic
                );
            }
        }

        return defaultMinTtl;
    }

    public timeToLive() {
        return Math.max(0, this.maxAge() - this.age()) * 1000;
    }

    public stale() {
        return this.maxAge() <= this.age();
    }

    public toObject(): ICachePolicyObject {
        return {
            a: this.noAuthorization,
            ch: this.cacheHeuristic,
            h: this.host,
            imm: this.immutableMinTtl,
            m: this.method,
            reqcc: this.reqcc,
            reqh: this.reqHeaders,
            rescc: this.rescc,
            resh: this.resHeaders,
            sh: this.isShared,
            st: this.status,
            t: this.responseTime,
            u: this.url,
            v: 1,
        };
    }

    /**
     * Headers for sending to the origin server to revalidate stale response.
     * Allows server to return 304 to allow reuse of the previous response.
     *
     * Hop by hop headers are always stripped.
     * Revalidation headers may be added or removed, depending on request.
     */
    public revalidationHeaders(incomingReq: IRequest) {
        assertRequestHasHeaders(incomingReq);

        const reqHeaders = incomingReq.headers as IRequestHeaders;
        const headers = this.copyWithoutHopByHopHeaders(reqHeaders);

        // This implementation does not understand range requests
        delete headers['if-range'];

        if (!this.requestMatches(incomingReq, true) || !this.storable()) {
            // revalidation allowed via HEAD
            // not for the same resource, or wasn't allowed to be cached anyway
            delete headers['if-none-match'];
            delete headers['if-modified-since'];
            return headers;
        }

        /**
         * /MUST send that entity-tag in any cache validation request (using
         * If-Match or If-None-Match) if an entity-tag has been provided by the
         * origin server.
         */
        if (this.resHeaders.etag) {
            headers['if-none-match'] = headers['if-none-match']
                ? `${headers['if-none-match']}, ${this.resHeaders.etag}`
                : this.resHeaders.etag;
        }

        /**
         * Clients MAY issue simple (non-subrange) GET requests with either weak
         * validators or strong validators. Clients MUST NOT use weak validators
         * in other forms of request.
         */
        const forbidsWeakValidators =
            headers['accept-ranges'] ||
            headers['if-match'] ||
            headers['if-unmodified-since'] ||
            (this.method && this.method !== 'GET');

        /*
         * SHOULD send the Last-Modified value in non-subrange cache validation
         * requests (using If-Modified-Since) if only a Last-Modified value has
         * been provided by the origin server.
         *
         * Note: This implementation does not understand partial responses (206)
         */
        if (forbidsWeakValidators) {
            delete headers['if-modified-since'];

            const ifNoneMatch = headers['if-none-match'];
            if (ifNoneMatch) {
                const etags = ifNoneMatch
                    .split(',')
                    .filter(isStronglyValidated);
                if (!etags.length) {
                    delete headers['if-none-match'];
                } else {
                    headers['if-none-match'] = etags.join(',').trim();
                }
            }
        } else if (
            this.resHeaders['last-modified'] &&
            !headers['if-modified-since']
        ) {
            headers['if-modified-since'] = this.resHeaders['last-modified'];
        }

        return headers;
    }

    /**
     * Creates new CachePolicy with information combined from the previews
     * response, and the new revalidation response.
     *
     * Returns {policy, modified} where modified is a boolean indicating
     * whether the response body has been modified, and old cached body can't
     * be used.
     *
     * @return {Object} {policy: CachePolicy, modified: Boolean}
     */
    public revalidatedPolicy(request: IRequest, response?: IResponse) {
        assertRequestHasHeaders(request);
        if (!response || !response.headers) {
            throw Error('Response headers missing');
        }

        /**
         * These aren't going to be supported exactly, since one CachePolicy
         * object doesn't know about all the other cached objects.
         */
        let matches = false;
        if (response.status != null && response.status !== 304) {
            matches = false;
        } else if (
            response.headers.etag &&
            isStronglyValidated(response.headers.etag)
        ) {
            /**
             * "All of the stored responses with the same strong validator are
             * selected. If none of the stored responses contain the same strong
             * validator, then the cache MUST NOT use the new response to update
             * any stored responses."
             */
            matches = !!(
                this.resHeaders.etag &&
                removeWeakValidatorPrefix(this.resHeaders.etag) ===
                    response.headers.etag
            );
        } else if (this.resHeaders.etag && response.headers.etag) {
            /*
             * "If the new response contains a weak validator and that validator
             * corresponds to one of the cache's stored responses, then the most
             * recent of those matching stored responses is selected for
             * update."
             */
            matches =
                removeWeakValidatorPrefix(this.resHeaders.etag) ===
                removeWeakValidatorPrefix(response.headers.etag);
        } else if (this.resHeaders['last-modified']) {
            matches =
                this.resHeaders['last-modified'] ===
                response.headers['last-modified'];
        } else {
            /*
             * If the new response does not include any form of validator (such
             * as in the case where a client generates an If-Modified-Since
             * request from a source other than the Last-Modified response
             * header field), and there is only one stored response, and that
             * stored response also lacks a validator, then that stored response
             * is selected for update.
             */
            if (
                !this.resHeaders.etag &&
                !this.resHeaders['last-modified'] &&
                !response.headers.etag &&
                !response.headers['last-modified']
            ) {
                matches = true;
            }
        }

        if (!matches) {
            return {
                /**
                 * Client receiving 304 without body, even if it's
                 * invalid/mismatched has no option but to reuse a cached body.
                 * We don't have a good way to tell clients to do error recovery
                 * in such case.
                 */
                matches: false,
                modified: response.status !== 304,
                policy: new CachePolicy(request, response),
            };
        }

        /*
         * use other header fields provided in the 304 (Not Modified) response
         * to replace all instances of the corresponding header fields in the
         * stored response.
         */
        const headers: IResponseHeaders = {};
        for (const k of Object.keys(this.resHeaders)) {
            headers[k] =
                response.headers[k] != null &&
                !excludedFromRevalidationUpdate.has(k)
                    ? response.headers[k]
                    : this.resHeaders[k];
        }

        const newResponse = {
            ...response,
            headers,
            method: this.method,
            status: this.status,
        };

        return {
            matches: true,
            modified: false,
            policy: new CachePolicy(request, newResponse, {
                cacheHeuristic: this.cacheHeuristic,
                immutableMinTimeToLive: this.immutableMinTtl,
                shared: this.isShared,
                trustServerDate: this.trustServerDate,
            }),
        };
    }

    private hasExplicitExpiration() {
        // 4.2.1 Calculating Freshness Lifetime
        return (
            (this.isShared && this.rescc['s-maxage']) ||
            this.rescc['max-age'] ||
            this.resHeaders.expires
        );
    }

    private requestMatches(req: IRequest, allowHeadMethod: boolean) {
        const reqHeaders = req.headers as IRequestHeaders;
        // The presented effective request URI and that of the stored response
        // match, and
        return (
            (!this.url || this.url === req.url) &&
            this.host === reqHeaders.host &&
            // the request method associated with the stored response allows
            // it to be used for the presented request, and
            (!req.method ||
                this.method === req.method ||
                (allowHeadMethod && req.method === 'HEAD')) &&
            // selecting header fields nominated by the stored response (if any)
            // match those presented, and
            this.varyMatches(req)
        );
    }

    private allowsStoringAuthenticated() {
        /**
         * following Cache-Control response directives (Section 5.2.2) have
         * such an effect: must-revalidate, public, and s-maxage.
         */
        return (
            this.rescc['must-revalidate'] ||
            this.rescc.public ||
            this.rescc['s-maxage']
        );
    }

    private varyMatches(req: IRequest) {
        assertRequestHasHeaders(req);

        if (!this.resHeaders.vary || this.reqHeaders == null) {
            return true;
        }

        // A Vary header field-value of "*" always fails to match
        if (this.resHeaders.vary === '*') {
            return false;
        }

        const fields = this.resHeaders.vary
            .trim()
            .toLowerCase()
            .split(/\s*,\s*/);

        const reqHeaders = req.headers as IRequestHeaders;

        for (const name of fields) {
            if (reqHeaders[name] !== this.reqHeaders[name]) {
                return false;
            }
        }

        return true;
    }

    private copyWithoutHopByHopHeaders(inHeaders: Headers) {
        const headers: Headers = {};

        for (const name of Object.keys(inHeaders)) {
            if (hopByHopHeaders.has(name)) {
                continue;
            }
            headers[name] = inHeaders[name];
        }
        // 9.1.  Connection
        if (inHeaders.connection) {
            const tokens = inHeaders.connection.trim().split(/\s*,\s*/);
            for (const name of tokens) {
                delete headers[name];
            }
        }
        if (headers.warning) {
            const warnings = headers.warning.split(',').filter(warning => {
                return !/^\s*1[0-9][0-9]/.test(warning);
            });
            if (!warnings.length) {
                delete headers.warning;
            } else {
                headers.warning = warnings.join(',').trim();
            }
        }
        return headers;
    }

    private ageValue() {
        const ageValue = parseInt(this.resHeaders.age as string, 10);
        return isFinite(ageValue) ? ageValue : 0;
    }

    private serverDate() {
        const dateValue = Date.parse(this.resHeaders.date as string);
        if (isFinite(dateValue)) {
            const maxClockDrift = 8 * 3600 * 1000;
            const clockDrift = Math.abs(this.responseTime - dateValue);
            if (clockDrift < maxClockDrift) {
                return dateValue;
            }
        }
        return this.responseTime;
    }
};

// rfc7231 6.1
const defaultCacheableStatusCodes = [
    200,
    203,
    204,
    206,
    300,
    301,
    404,
    405,
    410,
    414,
    501,
];

// This implementation does not understand partial responses (206)
const understoodStatuses = [
    200,
    203,
    204,
    300,
    301,
    302,
    303,
    307,
    308,
    404,
    405,
    410,
    414,
    501,
];

// 24 hours
const defaultImmutableMinTtl = 24 * 60 * 60 * 1000;

const hopByHopHeaders = new Set([
    'connection',
    'date',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

/*
 * Since the old body is reused, it doesn't make sense to change properties
 * of the body
 */
const excludedFromRevalidationUpdate = new Set([
    'content-encoding',
    'content-length',
    'content-range',
    'transfer-encoding',
]);

const weakValidatorPrefix = /^\s*W\//;

function parseCacheControl(header?: string): CacheControl {
    const cc: CacheControl = {};
    if (!header) {
        return cc;
    }

    /**
     * TODO: When there is more than one value present for a given directive
     * (e.g., two Expires header fields, multiple Cache-Control: max-age
     * directives), the directive's value is considered invalid. Caches are
     * encouraged to consider responses that have invalid freshness information
     * to be stale
     */

    // TODO: lame parsing
    const parts = header.trim().split(/\s*,\s*/);
    for (const part of parts) {
        const [k, v] = part.split(/\s*=\s*/, 2);
        // TODO: lame unquoting
        cc[k] = v == null ? true : v.replace(/^"|"$/g, '');
    }

    return cc;
}

function formatCacheControl(cc: IRequestCacheControl | IResponseCacheControl) {
    const parts = [];
    for (const k of Object.keys(cc)) {
        const v = cc[k];
        parts.push(v === true ? k : `${k}=${v}`);
    }
    if (!parts.length) {
        return;
    }
    return parts.join(', ');
}

function isStronglyValidated(etag: string) {
    return !weakValidatorPrefix.test(etag);
}

function removeWeakValidatorPrefix(etag: string) {
    return etag.replace(weakValidatorPrefix, '');
}

function assertRequestHasHeaders(req?: IRequest) {
    if (!req || !req.headers) {
        throw Error('Request headers missing');
    }
    return true;
}
