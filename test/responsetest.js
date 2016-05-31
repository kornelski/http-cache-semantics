'use strict';

const assert = require('assert');
const CachePolicy = require('..');

const req = {method:'GET', headers:{}};

describe('Response headers', function() {
    it('simple miss', function() {
        const cache = new CachePolicy(req, {headers:{}});
        assert(!cache.isFresh());
    });

    it('simple hit', function() {
        const cache = new CachePolicy(req, {headers:{'cache-control': 'public, max-age=999999'}});
        assert(cache.isFresh());
        assert.equal(cache.maxAge(), 999999);
    });

    it('cache with expires', function() {
        const cache = new CachePolicy(req, {headers:{
            'date': new Date().toGMTString(),
            'expires': new Date(Date.now() + 2000).toGMTString(),
        }});
        assert(cache.isFresh());
        assert.equal(2, cache.maxAge());
    });

    it('cache expires no date', function() {
        const cache = new CachePolicy(req, {headers:{
            'cache-control': 'public',
            'expires': new Date(Date.now()+3600*1000).toGMTString(),
        }});
        assert(cache.isFresh());
        assert(cache.maxAge() > 3595);
        assert(cache.maxAge() < 3605);
    });

    it('cache old files', function() {
        const cache = new CachePolicy(req, {headers:{
            'date': new Date().toGMTString(),
            'last-modified': 'Mon, 07 Mar 2016 11:52:56 GMT',
        }});
        assert(cache.isFresh());
        assert(cache.maxAge() > 100);
    });

    it('pragma: no-cache', function() {
        const cache = new CachePolicy(req, {headers:{
            'pragma': 'no-cache',
            'last-modified': 'Mon, 07 Mar 2016 11:52:56 GMT',
        }});
        assert(!cache.isFresh());
    });

    it('no-store', function() {
        const cache = new CachePolicy(req, {headers:{
            'cache-control': 'no-store, public, max-age=1',
        }});
        assert(!cache.isFresh());
        assert.equal(0, cache.maxAge());
    });

    it('observe private cache', function() {
        const privateHeader = {
            'cache-control': 'private, max-age=1234',
        };
        const proxyCache = new CachePolicy(req, {headers:privateHeader});
        assert(!proxyCache.isFresh());
        assert.equal(0, proxyCache.maxAge());

        const uaCache = new CachePolicy(req, {headers:privateHeader}, {shared:false});
        assert(uaCache.isFresh());
        assert.equal(1234, uaCache.maxAge());
    });

    it('don\'t share cookies', function() {
        const cookieHeader = {
            'set-cookie': 'foo=bar',
            'cache-control': 'max-age=99',
        };
        const proxyCache = new CachePolicy(req, {headers:cookieHeader}, {shared:true});
        assert(!proxyCache.isFresh());
        assert.equal(0, proxyCache.maxAge());

        const uaCache = new CachePolicy(req, {headers:cookieHeader}, {shared:false});
        assert(uaCache.isFresh());
        assert.equal(99, uaCache.maxAge());
    });

    it('cache explicitly public cookie', function() {
        const cookieHeader = {
            'set-cookie': 'foo=bar',
            'cache-control': 'max-age=5, public',
        };
        const proxyCache = new CachePolicy(req, {headers:cookieHeader}, {shared:true});
        assert(proxyCache.isFresh());
        assert.equal(5, proxyCache.maxAge());
    });

    it('miss max-age=0', function() {
        const cache = new CachePolicy(req, {headers:{
            'cache-control': 'public, max-age=0',
        }});
        assert(!cache.isFresh());
        assert.equal(0, cache.maxAge());
    });

    it('cacheable 301', function() {
        const cache = new CachePolicy(req, {
            status: 301,
            headers:{
                'last-modified': 'Mon, 07 Mar 2016 11:52:56 GMT',
            }});
        assert(cache.isFresh());
    });

    it('cacheable 303', function() {
        const cache = new CachePolicy(req, {
            status: 303,
            headers:{
                'cache-control': 'max-age=1000',
            }});
        assert(cache.isFresh());
    });

    it('expired expires cached with max-age', function() {
        const cache = new CachePolicy(req, {headers:{
            'cache-control': 'public, max-age=9999',
            'expires': 'Sat, 07 May 2016 15:35:18 GMT',
        }});
        assert(cache.isFresh());
        assert.equal(9999, cache.maxAge());
    });

    it('expired expires cached with s-maxage', function() {
        const sMaxAgeHeaders = {
            'cache-control': 'public, s-maxage=9999',
            'expires': 'Sat, 07 May 2016 15:35:18 GMT',
        };
        const proxyCache = new CachePolicy(req, {headers:sMaxAgeHeaders});
        assert(proxyCache.isFresh());
        assert.equal(9999, proxyCache.maxAge());

        const uaCache = new CachePolicy(req, {headers:sMaxAgeHeaders}, {shared:false});
        assert(!uaCache.isFresh());
        assert.equal(0, uaCache.maxAge());
    });

    it('max-age wins over future expires', function() {
        const cache = new CachePolicy(req, {headers:{
            'cache-control': 'public, max-age=333',
            'expires': new Date(Date.now()+3600*1000).toGMTString(),
        }});
        assert(cache.isFresh());
        assert.equal(333, cache.maxAge());
    });
});
