'use strict';

const assert = require('assert');
const CachePolicy = require('..');

const publicCacheableResponse = {headers:{'cache-control': 'public, max-age=222'}};
const cacheableResponse = {headers:{'cache-control': 'max-age=111'}};

describe('Request properties', function() {
    it('No store kills cache', function() {
        const cache = new CachePolicy({method:'GET',headers:{'cache-control':'no-store'}}, publicCacheableResponse);
        assert(!cache.isFresh());
        assert(!cache.storable());
    });

    it('POST not cacheable by default', function() {
        const cache = new CachePolicy({method:'POST',headers:{}}, {headers:{'cache-control': 'public'}});
        assert(!cache.isFresh());
        assert(!cache.storable());
    });

    it('POST cacheable explicitly', function() {
        const cache = new CachePolicy({method:'POST',headers:{}}, publicCacheableResponse);
        assert(cache.isFresh());
        assert(cache.storable());
    });

    it('Public cacheable auth is OK', function() {
        const cache = new CachePolicy({method:'GET',headers:{'authorization': 'test'}}, publicCacheableResponse);
        assert(cache.isFresh());
        assert(cache.storable());
    });

    it('Auth prevents caching by default', function() {
        const cache = new CachePolicy({method:'GET',headers:{'authorization': 'test'}}, cacheableResponse);
        assert(!cache.isFresh());
        assert(!cache.storable());
    });
});
