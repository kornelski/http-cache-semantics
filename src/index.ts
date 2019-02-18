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

import cloneDeep = require('lodash.clonedeep');

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

function shouldRespectPragma(headers: Headers) {
    return (
        headers['cache-control'] == null &&
        headers.pragma != null &&
        headers.pragma.includes('no-cache')
    );
}

function parseCacheControl(header?: string): CacheControl {
    if (!header) {
        return {};
    }

    /**
     * TODO: When there is more than one value present for a given directive
     * (e.g., two Expires header fields, multiple Cache-Control: max-age
     * directives), the directive's value is considered invalid. Caches are
     * encouraged to consider responses that have invalid freshness information
     * to be stale
     */

    // TODO: lame parsing
    return header
        .trim()
        .split(/\s*,\s*/)
        .reduce<CacheControl>((cacheControl, part) => {
            const [k, v] = part.split(/\s*=\s*/, 2);
            return {
                ...cacheControl,
                // TODO: lame unquoting
                [k]: v == null ? true : v.replace(/^"|"$/g, ''),
            };
        }, {});
}

function formatCacheControl(cc: IRequestCacheControl | IResponseCacheControl) {
    const keys = Object.keys(cc);

    if (!keys.length) {
        return;
    }

    return Object.keys(cc)
        .map(k => {
            const v = cc[k];
            return v === true ? k : `${k}=${v}`;
        })
        .join(', ');
}

const weakValidatorPrefix = /^\s*W\//;

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

export = class CachePolicy implements ICachePolicyFields {
    public static fromObject(obj: ICachePolicyObject): CachePolicy {
        if (!obj || obj.v !== 1) {
            throw Error('Invalid serialization');
        }

        const policy = cloneDeep<ICachePolicyFields>({
            _cacheHeuristic: obj.ch,
            _host: obj.h,
            _immutableMinTtl:
                obj.imm == null ? defaultImmutableMinTtl : obj.imm,
            _isShared: obj.sh,
            _method: obj.m,
            _noAuthorization: obj.a,
            _reqHeaders: obj.reqh,
            _reqcc: obj.reqcc,
            _resHeaders: obj.resh,
            _rescc: obj.rescc,
            _responseTime: obj.t,
            _status: obj.st,
            _url: obj.u,
        });

        return Object.assign(Object.create(CachePolicy.prototype), policy);
    }

    public readonly _cacheHeuristic: number;
    public readonly _host?: string;
    public readonly _immutableMinTtl: number;
    public readonly _isShared: boolean;
    public readonly _method: HttpMethod;
    public readonly _noAuthorization: boolean;
    public readonly _reqHeaders?: IRequestHeaders;
    public readonly _reqcc: IRequestCacheControl;
    public readonly _resHeaders: IResponseHeaders;
    public readonly _rescc: IResponseCacheControl;
    public readonly _responseTime: number;
    public readonly _status: number;
    public readonly _url?: string;

    private readonly _trustServerDate: boolean;

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

        this._responseTime = Date.now();
        this._isShared = shared !== false;
        this._trustServerDate =
            trustServerDate == null ? true : trustServerDate;
        // 10% matches IE
        this._cacheHeuristic = cacheHeuristic == null ? 0.1 : cacheHeuristic;
        this._immutableMinTtl =
            immutableMinTimeToLive == null
                ? defaultImmutableMinTtl
                : immutableMinTimeToLive;

        this._status = res.status == null ? 200 : res.status;
        this._resHeaders = cloneDeep(res.headers);
        this._rescc = parseCacheControl(this._resHeaders['cache-control']);
        this._method = req.method == null ? 'GET' : req.method;
        this._url = req.url;
        this._host = reqHeaders.host;
        this._noAuthorization = !reqHeaders.authorization;
        if (res.headers.vary) {
            // Don't keep all request headers if they won't be used
            this._reqHeaders = cloneDeep(reqHeaders);
        }
        this._reqcc = parseCacheControl(reqHeaders['cache-control']);

        /**
         * Assume that if someone { uses } legacy, non-standard uncecessary
         * options they don't understand caching, so there's no point stricly
         * adhering to the blindly copy&pasted directives.
         */
        if (
            ignoreCargoCult &&
            this._rescc['pre-check'] != null &&
            this._rescc['post-check'] != null
        ) {
            delete this._rescc['pre-check'];
            delete this._rescc['post-check'];
            delete this._rescc['no-cache'];
            delete this._rescc['no-store'];
            delete this._rescc['must-revalidate'];

            const cacheControl = formatCacheControl(this._rescc);
            if (cacheControl == null) {
                delete this._resHeaders['cache-control'];
            } else {
                this._resHeaders['cache-control'] = cacheControl;
            }

            delete this._resHeaders.expires;
            delete this._resHeaders.pragma;
        }

        /**
         * When the Cache-Control header field is not present in a request,
         * caches MUST consider the no-cache request pragma-directive as having
         * the same effect as if "Cache-Control: no-cache" were present
         * (see Section 5.2.1).
         */
        if (shouldRespectPragma(res.headers)) {
            this._rescc['no-cache'] = true;
        }
    }

    public storable() {
        /**
         * The "no-store" request directive indicates that a cache MUST NOT
         * store any part of either this request or any response to it.
         */
        return !!(
            !this._reqcc['no-store'] &&
            /*
             * A cache MUST NOT store a response to any request, unless:
             * - The request method is understood by the cache and defined as
             *   being cacheable, and
             */
            (this._method === 'GET' ||
                this._method === 'HEAD' ||
                (this._method === 'POST' && this._hasExplicitExpiration())) &&
            // the response status code is understood by the cache, and
            understoodStatuses.indexOf(this._status) !== -1 &&
            /*
             * - the "no-store" cache directive does not appear in request or
             *   response header fields, and
             */
            !this._rescc['no-store'] &&
            /*
             * - the "private" response directive does not appear in the
                 response if the cache is shared, and
             */
            (!this._isShared || !this._rescc.private) &&
            /**
             * - the Authorization header field does not appear in the request,
             *   if the cache is shared,
             */
            (!this._isShared ||
                this._noAuthorization ||
                this._allowsStoringAuthenticated()) &&
            /**
             * the response either:
             * - contains an Expires header field, or
             */
            (this._resHeaders.expires ||
                /**
                 * - contains a max-age response directive, or
                 * - contains a s-maxage response directive and the cache is shared, or
                 * - contains a public response directive.
                 */
                this._rescc.public ||
                this._rescc['max-age'] ||
                this._rescc['s-maxage'] ||
                // has a status code that is defined as cacheable by default
                defaultCacheableStatusCodes.indexOf(this._status) !== -1)
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

        if (requestCC['no-cache'] != null || shouldRespectPragma(reqHeaders)) {
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
                !this._rescc['must-revalidate'] &&
                (requestCC['max-stale'] === true ||
                    parseInt(requestCC['max-stale'], 10) >
                        this.age() - this.maxAge());
            if (!allowsStale) {
                return false;
            }
        }

        return this._requestMatches(req, false);
    }

    public responseHeaders() {
        const headers = this._copyWithoutHopByHopHeaders(this._resHeaders);
        const age = this.age();

        /**
         * A cache SHOULD generate 113 warning if it heuristically chose a
         * freshness lifetime greater than 24 hours and the response's age is
         * greater than 24 hours.
         */

        const warningThreshold = 24 * 60 * 60;
        if (
            age > warningThreshold &&
            !this._hasExplicitExpiration() &&
            this.maxAge() > warningThreshold
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
        if (this._trustServerDate) {
            return this._serverDate();
        }
        return this._responseTime;
    }

    /**
     * Value of the Age header, in seconds, updated for the current time. May
     * be fractional.
     *
     * @return Number
     */
    public age() {
        let age = Math.max(0, (this._responseTime - this.date()) / 1000);
        if (this._resHeaders.age) {
            const ageValue = this._ageValue();
            if (ageValue > age) {
                age = ageValue;
            }
        }

        const residentTime = (Date.now() - this._responseTime) / 1000;
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
        if (!this.storable() || this._rescc['no-cache']) {
            return 0;
        }

        /**
         * Shared responses with cookies are cacheable according to the RFC,
         * but IMHO it'd be unwise to do so by default so this implementation
         * requires explicit opt-in via public header
         */
        if (
            this._isShared &&
            (this._resHeaders['set-cookie'] &&
                !this._rescc.public &&
                !this._rescc.immutable)
        ) {
            return 0;
        }

        if (this._resHeaders.vary === '*') {
            return 0;
        }

        if (this._isShared) {
            if (this._rescc['proxy-revalidate']) {
                return 0;
            }
            /**
             * if a response includes the s-maxage directive, a shared cache
             * recipient MUST ignore the Expires field.
             */
            if (this._rescc['s-maxage']) {
                return parseInt(this._rescc['s-maxage'], 10);
            }
        }

        /**
         * If a response includes a Cache-Control field with the max-age
         * directive, a recipient MUST ignore the Expires field.
         */
        if (this._rescc['max-age']) {
            return parseInt(this._rescc['max-age'], 10);
        }

        const defaultMinTtl = this._rescc.immutable ? this._immutableMinTtl : 0;

        const dateValue = this._serverDate();
        if (this._resHeaders.expires) {
            const expires = Date.parse(this._resHeaders.expires);
            /**
             * A cache recipient MUST interpret invalid date formats, especially
             * the value "0", as representing a time in the past (i.e., "already
             * expired").
             */
            if (isNaN(expires) || expires < dateValue) {
                return 0;
            }
            return Math.max(defaultMinTtl, (expires - dateValue) / 1000);
        }

        if (this._resHeaders['last-modified'] != null) {
            const lastModified = Date.parse(this._resHeaders['last-modified']);
            if (!isNaN(lastModified) && dateValue > lastModified) {
                return Math.max(
                    defaultMinTtl,
                    ((dateValue - lastModified) / 1000) * this._cacheHeuristic
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
        return cloneDeep<ICachePolicyObject>({
            a: this._noAuthorization,
            ch: this._cacheHeuristic,
            h: this._host,
            imm: this._immutableMinTtl,
            m: this._method,
            reqcc: this._reqcc,
            reqh: this._reqHeaders,
            rescc: this._rescc,
            resh: this._resHeaders,
            sh: this._isShared,
            st: this._status,
            t: this._responseTime,
            u: this._url,
            v: 1,
        });
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
        const headers = this._copyWithoutHopByHopHeaders(reqHeaders);

        // This implementation does not understand range requests
        delete headers['if-range'];

        if (!this._requestMatches(incomingReq, true) || !this.storable()) {
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
        if (this._resHeaders.etag) {
            headers['if-none-match'] = headers['if-none-match']
                ? `${headers['if-none-match']}, ${this._resHeaders.etag}`
                : this._resHeaders.etag;
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
            (this._method && this._method !== 'GET');

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
            this._resHeaders['last-modified'] &&
            !headers['if-modified-since']
        ) {
            headers['if-modified-since'] = this._resHeaders['last-modified'];
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
                this._resHeaders.etag &&
                removeWeakValidatorPrefix(this._resHeaders.etag) ===
                    response.headers.etag
            );
        } else if (this._resHeaders.etag && response.headers.etag) {
            /*
             * "If the new response contains a weak validator and that validator
             * corresponds to one of the cache's stored responses, then the most
             * recent of those matching stored responses is selected for
             * update."
             */
            matches =
                removeWeakValidatorPrefix(this._resHeaders.etag) ===
                removeWeakValidatorPrefix(response.headers.etag);
        } else if (this._resHeaders['last-modified']) {
            matches =
                this._resHeaders['last-modified'] ===
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
                !this._resHeaders.etag &&
                !this._resHeaders['last-modified'] &&
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
        for (const k of Object.keys(this._resHeaders)) {
            headers[k] =
                response.headers[k] != null &&
                !excludedFromRevalidationUpdate.has(k)
                    ? response.headers[k]
                    : this._resHeaders[k];
        }

        const newResponse = {
            ...response,
            headers,
            method: this._method,
            status: this._status,
        };

        return {
            matches: true,
            modified: false,
            policy: new CachePolicy(request, newResponse, {
                cacheHeuristic: this._cacheHeuristic,
                immutableMinTimeToLive: this._immutableMinTtl,
                shared: this._isShared,
                trustServerDate: this._trustServerDate,
            }),
        };
    }

    private _hasExplicitExpiration() {
        // 4.2.1 Calculating Freshness Lifetime
        return (
            (this._isShared && this._rescc['s-maxage']) ||
            this._rescc['max-age'] ||
            this._resHeaders.expires
        );
    }

    private _requestMatches(req: IRequest, allowHeadMethod: boolean) {
        const reqHeaders = req.headers as IRequestHeaders;
        // The presented effective request URI and that of the stored response
        // match, and
        return (
            (!this._url || this._url === req.url) &&
            this._host === reqHeaders.host &&
            // the request method associated with the stored response allows
            // it to be used for the presented request, and
            (!req.method ||
                this._method === req.method ||
                (allowHeadMethod && req.method === 'HEAD')) &&
            // selecting header fields nominated by the stored response (if any)
            // match those presented, and
            this._varyMatches(req)
        );
    }

    private _allowsStoringAuthenticated() {
        /**
         * following Cache-Control response directives (Section 5.2.2) have
         * such an effect: must-revalidate, public, and s-maxage.
         */
        return (
            this._rescc['must-revalidate'] ||
            this._rescc.public ||
            this._rescc['s-maxage']
        );
    }

    private _varyMatches(req: IRequest) {
        assertRequestHasHeaders(req);

        if (!this._resHeaders.vary || this._reqHeaders == null) {
            return true;
        }

        // A Vary header field-value of "*" always fails to match
        if (this._resHeaders.vary === '*') {
            return false;
        }

        const fields = this._resHeaders.vary
            .trim()
            .toLowerCase()
            .split(/\s*,\s*/);

        const reqHeaders = req.headers as IRequestHeaders;

        for (const name of fields) {
            if (reqHeaders[name] !== this._reqHeaders[name]) {
                return false;
            }
        }

        return true;
    }

    private _copyWithoutHopByHopHeaders(inHeaders: Headers) {
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
            const warnings = headers.warning
                .split(',')
                .filter(warning => !/^\s*1[0-9][0-9]/.test(warning));
            if (!warnings.length) {
                delete headers.warning;
            } else {
                headers.warning = warnings.join(',').trim();
            }
        }
        return headers;
    }

    private _ageValue() {
        const ageValue = parseInt(this._resHeaders.age as string, 10);
        return isNaN(ageValue) ? 0 : ageValue;
    }

    private _serverDate() {
        const dateValue = Date.parse(this._resHeaders.date as string);
        if (!isNaN(dateValue)) {
            const maxClockDrift = 8 * 60 * 60 * 1000;
            const clockDrift = Math.abs(this._responseTime - dateValue);
            if (clockDrift < maxClockDrift) {
                return dateValue;
            }
        }
        return this._responseTime;
    }
};
