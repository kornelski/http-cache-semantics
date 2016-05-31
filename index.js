'use strict';

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
        if (this._rescc['no-cache'] || this._rescc['no-store']) {
            return 0;
        }

        // Shared responses with cookies are cacheable according to the RFC, but IMHO it'd be unwise to do so by default
        // so this implementation requires explicit opt-in via public header
        if (this._isShared && (this._rescc['private'] || (this._res.headers['set-cookie'] && !this._rescc['public']))) {
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

