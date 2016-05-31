'use strict';

const assert = require('assert');
const CachePolicy = require('..');

describe('Vary', function() {
    it('Basic', function() {
        const cache1 = new CachePolicy({method:'GET',headers:{'weather': 'nice'}}, {headers:{'vary':'weather'}});
        const cache2 = new CachePolicy({method:'GET',headers:{'weather': 'bad'}}, {headers:{'vary':'WEATHER'}});

        assert.equal(cache1.cacheKey(), cache1.cacheKey());
        assert.equal(cache2.cacheKey(), cache2.cacheKey());
        assert.notEqual(cache1.cacheKey(), cache2.cacheKey());
    });

    it("* doesn't match other", function() {
        const cache1 = new CachePolicy({method:'GET',headers:{'weather': 'ok'}}, {headers:{'vary':'*'}});
        const cache2 = new CachePolicy({method:'GET',headers:{'weather': 'ok'}}, {headers:{'vary':'weather'}});

        assert.equal(cache2.cacheKey(), cache2.cacheKey());
        assert.notEqual(cache1.cacheKey(), cache2.cacheKey());
    });

    it("* is stale", function() {
        const cache1 = new CachePolicy({method:'GET',headers:{'weather': 'ok'}}, {headers:{'cache-control':'public,max-age=99', 'vary':'*'}});
        const cache2 = new CachePolicy({method:'GET',headers:{'weather': 'ok'}}, {headers:{'cache-control':'public,max-age=99', 'vary':'weather'}});

        assert.notEqual(cache1.cacheKey(), cache2.cacheKey());

        assert(cache1.stale());
        assert(!cache2.stale());
    });

    it('Values are case-sensitive', function() {
        const cache1 = new CachePolicy({method:'GET',headers:{'weather': 'BAD'}}, {headers:{'vary':'weather'}});
        const cache2 = new CachePolicy({method:'GET',headers:{'weather': 'bad'}}, {headers:{'vary':'weather'}});

        assert.notEqual(cache1.cacheKey(), cache2.cacheKey());
    });

    it('Irrelevant headers ignored', function() {
        const cache1 = new CachePolicy({method:'GET',headers:{'weather': 'nice'}}, {headers:{'vary':'moon-phase'}});
        const cache2 = new CachePolicy({method:'GET',headers:{'weather': 'bad'}}, {headers:{'vary':'moon-phase'}});

        assert.equal(cache1.cacheKey(), cache1.cacheKey());
        assert.equal(cache1.cacheKey(), cache2.cacheKey());
    });

    it('Absence is meaningful', function() {
        const cache1 = new CachePolicy({method:'GET',headers:{'weather': 'nice'}}, {headers:{'vary':'moon-phase'}});
        const cache2 = new CachePolicy({method:'GET',headers:{'weather': 'bad'}}, {headers:{'vary':'sunshine'}});

        assert.equal(cache2.cacheKey(), cache2.cacheKey());
        assert.notEqual(cache1.cacheKey(), cache2.cacheKey());
    });

    it('All values must match', function() {
        const cache1 = new CachePolicy({method:'GET',headers:{'sun': 'shining', 'weather': 'nice'}}, {headers:{'vary':'weather, sun'}});
        const cache2 = new CachePolicy({method:'GET',headers:{'sun': 'shining', 'weather': 'bad'}}, {headers:{'vary':'weather, sun'}});
        assert.notEqual(cache1.cacheKey(), cache2.cacheKey());
    });

    it('Order is irrelevant', function() {
        const cache1 = new CachePolicy({method:'GET',headers:{'weather': 'nice'}}, {headers:{'vary':'moon-phase, SUNSHINE'}});
        const cache2 = new CachePolicy({method:'GET',headers:{'weather': 'bad'}}, {headers:{'vary':'sunshine, moon-phase'}});
        assert.equal(cache1.cacheKey(), cache2.cacheKey());

        const cache3 = new CachePolicy({method:'GET',headers:{'weather': 'nice'}}, {headers:{'vary':'moon-phase, weather'}});
        const cache4 = new CachePolicy({method:'GET',headers:{'weather': 'nice'}}, {headers:{'vary':'weather, moon-phase'}});
        assert.equal(cache3.cacheKey(), cache4.cacheKey());

        assert.notEqual(cache1.cacheKey(), cache3.cacheKey());
        assert.notEqual(cache2.cacheKey(), cache4.cacheKey());
    });
});
