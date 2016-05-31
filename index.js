'use strict';
// rfc7231 6.1
const statusCodeCacheableByDefault = [200, 203, 204, 206, 300, 301, 404, 405, 410, 414, 501];

// This implementation does not understand partial responses (206)
const understoodStatuses = [200, 204, 301, 302, 303, 404, 410, 501];


function parseCacheControl(header) {
    const cc = {};
    if (!header) return cc;

    // TODO: When there is more than one value present for a given directive (e.g., two Expires header fields, multiple Cache-Control: max-age directives),
    // the directive's value is considered invalid. Caches are encouraged to consider responses that have invalid freshness information to be stale
    const parts = header.split(/\s*,\s*/); // TODO: lame parsing
    for(const part of parts) {
        const [k,v] = part.split(/\s*=\s*/);
        cc[k] = (v === undefined) ? true : v.replace(/^"|"$/g, ''); // TODO: lame unquoting
    }

    // The s-maxage directive also implies the semantics of the proxy-revalidate response directive.
    if ('s-maxage' in cc) {
        cc['proxy-revalidate'] = true;
    }
    return cc;
}

function CachePolicy(req, res, {shared} = {}) {
    if (!res || !res.headers) {
        throw Error("Response headers missing");
    }
    if (!req || !req.headers) {
        throw Error("Request headers missing");
    }

    this._responseTime = this.now();
    this._isShared = shared !== false;
    this._res = res;
    this._rescc = parseCacheControl(res.headers['cache-control']);
    this._req = req;
    this._reqcc = parseCacheControl(req.headers['cache-control']);

    // When the Cache-Control header field is not present in a request, caches MUST consider the no-cache request pragma-directive
    // as having the same effect as if "Cache-Control: no-cache" were present (see Section 5.2.1).
    if (!res.headers['cache-control'] && /no-cache/.test(res.headers.pragma)) {
        this._rescc['no-cache'] = true;
    }
}

CachePolicy.prototype = {
    now() {
        return Date.now();
    },

    storable() {
        const status = (this._res.status === undefined) ? 200 : this._res.status;

        // The "no-store" request directive indicates that a cache MUST NOT store any part of either this request or any response to it.
        return !this._reqcc['no-store'] &&
            // A cache MUST NOT store a response to any request, unless:
            // The request method is understood by the cache and defined as being cacheable, and
            (!this._req.method || 'GET' === this._req.method || 'HEAD' === this._req.method || ('POST' === this._req.method && this._hasExplicitExpiration())) &&
            // the response status code is understood by the cache, and
            understoodStatuses.includes(status) &&
            // the "no-store" cache directive does not appear in request or response header fields, and
            !this._rescc['no-store'] &&
            // the "private" response directive does not appear in the response, if the cache is shared, and
            (!this._isShared || !this._rescc.private) &&
            // the Authorization header field does not appear in the request, if the cache is shared,
            (!this._isShared || !this._req.headers['authorization'] || this._allowsStoringAuthenticated()) &&
            // the response either:
            (
                // contains an Expires header field, or
                this._res.headers.expires ||
                // contains a max-age response directive, or
                // contains a s-maxage response directive and the cache is shared, or
                // contains a public response directive.
                this._rescc.public || this._rescc['max-age'] || this._rescc['s-maxage'] ||
                // has a status code that is defined as cacheable by default
                statusCodeCacheableByDefault.includes(status)
            );
    },

    _hasExplicitExpiration() {
        // 4.2.1 Calculating Freshness Lifetime
        return (this._isShared && this._rescc['s-maxage']) ||
            this._rescc['max-age'] ||
            this._res.headers.expires;
    },

    _allowsStoringAuthenticated() {
        //  following Cache-Control response directives (Section 5.2.2) have such an effect: must-revalidate, public, and s-maxage.
        return this._rescc['must-revalidate'] || this._rescc['public'] || this._rescc['s-maxage'];
    },

    /**
     * Value of the Date response header or current time if Date was demed invalid
     * @return timestamp
     */
    date() {
        const dateValue = Date.parse(this._res.headers.date)
        const maxClockDrift = 8*3600*1000;
        if (Number.isNaN(dateValue) || dateValue < this._responseTime-maxClockDrift || dateValue > this._responseTime+maxClockDrift) {
            return this._responseTime;
        }
        return dateValue;
    },

    /**
     * Value of the Age header, in seconds, updated for the current time
     * @return Number
     */
    age() {
        let age = Math.max(0, (this._responseTime - this.date())/1000);
        if (this._res.headers.age) {
            let ageValue = parseInt(this._res.headers.age);
            if (isFinite(ageValue)) {
                if (ageValue > age) age = ageValue;
            }
        }

        const residentTime = (this.now() - this._responseTime)/1000;
        return age + residentTime;
    },

    maxAge() {
        if (!this.storable() || this._rescc['no-cache']) {
            return 0;
        }

        // Shared responses with cookies are cacheable according to the RFC, but IMHO it'd be unwise to do so by default
        // so this implementation requires explicit opt-in via public header
        if (this._isShared && (this._res.headers['set-cookie'] && !this._rescc['public'])) {
            return 0;
        }

        // TODO: vary is not supported yet
        if (this._res.headers['vary']) {
            return 0;
        }

        if (this._isShared) {
            // if a response includes the s-maxage directive, a shared cache recipient MUST ignore the Expires field.
            if (this._rescc['s-maxage']) {
                return parseInt(this._rescc['s-maxage'], 10);
            }
        }

        // If a response includes a Cache-Control field with the max-age directive, a recipient MUST ignore the Expires field.
        if (this._rescc['max-age']) {
            return parseInt(this._rescc['max-age'], 10);
        }

        const dateValue = this.date();
        if (this._res.headers['expires']) {
            const expires = Date.parse(this._res.headers['expires']);
            // A cache recipient MUST interpret invalid date formats, especially the value "0", as representing a time in the past (i.e., "already expired").
            if (Number.isNaN(expires) || expires < dateValue) {
                return 0;
            }
            return (expires - dateValue)/1000;
        }

        if (this._res.headers['last-modified']) {
            const lastModified = Date.parse(this._res.headers['last-modified']);
            if (isFinite(lastModified) && dateValue > lastModified) {
                return (dateValue - lastModified) * 0.00001; // In absence of other information cache for 1% of item's age
            }
        }
        return 0;
    },

    isFresh() {
        return this.maxAge() > this.age();
    },
};

module.exports = CachePolicy;

