'use strict';
/*
 * Copyright (C) 2011 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const assert = require('assert');
const CachePolicy = require('..');

describe('okhttp tests', function() {
    it('response caching by response code', function() {
        // Test each documented HTTP/1.1 code, plus the first unused value in each range.
        // http://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html

        assertCached(false, 100);
        assertCached(false, 101);
        assertCached(false, 102);
        assertCached(true, 200);
        assertCached(false, 201);
        assertCached(false, 202);
        assertCached(true, 203);
        assertCached(true, 204);
        assertCached(false, 205);
        assertCached(false, 206); //Electing to not cache partial responses
        assertCached(false, 207);
        assertCached(true, 300);
        assertCached(true, 301);
        assertCached(true, 302);
        // assertCached(false, 303);
        assertCached(false, 304);
        assertCached(false, 305);
        assertCached(false, 306);
        assertCached(true, 307);
        assertCached(true, 308);
        assertCached(false, 400);
        assertCached(false, 401);
        assertCached(false, 402);
        assertCached(false, 403);
        assertCached(true, 404);
        assertCached(true, 405);
        assertCached(false, 406);
        assertCached(false, 408);
        assertCached(false, 409);
        // the HTTP spec permits caching 410s, but the RI doesn't.
        assertCached(true, 410);
        assertCached(false, 411);
        assertCached(false, 412);
        assertCached(false, 413);
        assertCached(true, 414);
        assertCached(false, 415);
        assertCached(false, 416);
        assertCached(false, 417);
        assertCached(false, 418);
        assertCached(false, 429);

        assertCached(false, 500);
        assertCached(true, 501);
        assertCached(false, 502);
        assertCached(false, 503);
        assertCached(false, 504);
        assertCached(false, 505);
        assertCached(false, 506);
    });

    function assertCached(shouldPut, responseCode) {
        let expectedResponseCode = responseCode;

        const mockResponse = {
            headers: {
                'last-modified': formatDate(-1, 3600),
                expires: formatDate(1, 3600),
                'www-authenticate': 'challenge',
            },
            status: responseCode,
            body: 'ABCDE',
        };
        if (responseCode == 407) {
            mockResponse.headers['proxy-authenticate'] =
                'Basic realm="protected area"';
        } else if (responseCode == 401) {
            mockResponse.headers['www-authenticate'] =
                'Basic realm="protected area"';
        } else if (responseCode == 204 || responseCode == 205) {
            mockResponse.body = ''; // We forbid bodies for 204 and 205.
        }

        const request = { url: '/', headers: {} };

        const cache = new CachePolicy(request, mockResponse, { shared: false });

        assert.equal(shouldPut, cache.storable());
    }

    it('default expiration date fully cached for less than24 hours', function() {
        //      last modified: 105 seconds ago
        //             served:   5 seconds ago
        //   default lifetime: (105 - 5) / 10 = 10 seconds
        //            expires:  10 seconds from served date = 5 seconds from now
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    'last-modified': formatDate(-105, 1),
                    date: formatDate(-5, 1),
                },
                body: 'A',
            },
            { shared: false }
        );

        assert(cache.timeToLive() > 4000);
    });

    it('default expiration date fully cached for more than24 hours', function() {
        //      last modified: 105 days ago
        //             served:   5 days ago
        //   default lifetime: (105 - 5) / 10 = 10 days
        //            expires:  10 days from served date = 5 days from now
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    'last-modified': formatDate(-105, 3600 * 24),
                    date: formatDate(-5, 3600 * 24),
                },
                body: 'A',
            },
            { shared: false }
        );

        assert(cache.maxAge() >= 10 * 3600 * 24);
        assert(cache.timeToLive() + 1000 >= 5 * 3600 * 24);
    });

    it('max age in the past with date header but no last modified header', function() {
        // Chrome interprets max-age relative to the local clock. Both our cache
        // and Firefox both use the earlier of the local and server's clock.
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    date: formatDate(-120, 1),
                    'cache-control': 'max-age=60',
                },
            },
            { shared: false }
        );

        assert(!cache.stale());
    });

    it('maxAge timetolive', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    date: formatDate(120, 1),
                    'cache-control': 'max-age=60',
                },
            },
            { shared: false }
        );
        const now = Date.now();
        cache.now = () => now

        assert(!cache.stale());
        assert.equal(cache.timeToLive(), 60000);
    });

    it('stale-if-error timetolive', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    date: formatDate(120, 1),
                    'cache-control': 'max-age=60, stale-if-error=200',
                },
            },
            { shared: false }
        );

        assert(!cache.stale());
        assert.equal(cache.timeToLive(), 260000);
    });

    it('stale-while-revalidate timetolive', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    date: formatDate(120, 1),
                    'cache-control': 'max-age=60, stale-while-revalidate=200',
                },
            },
            { shared: false }
        );

        assert(!cache.stale());
        assert.equal(cache.timeToLive(), 260000);
    });

    it('max age preferred over lower shared max age', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    date: formatDate(-2, 60),
                    'cache-control': 's-maxage=60, max-age=180',
                },
            },
            { shared: false }
        );

        assert.equal(cache.maxAge(), 180);
    });

    it('max age preferred over higher max age', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: 360,
                    'cache-control': 's-maxage=60, max-age=180',
                },
            },
            { shared: false }
        );

        assert(cache.stale());
    });

    it('request method options is not cached', function() {
        testRequestMethodNotCached('OPTIONS');
    });

    it('request method put is not cached', function() {
        testRequestMethodNotCached('PUT');
    });

    it('request method delete is not cached', function() {
        testRequestMethodNotCached('DELETE');
    });

    it('request method trace is not cached', function() {
        testRequestMethodNotCached('TRACE');
    });

    function testRequestMethodNotCached(method) {
        // 1. seed the cache (potentially)
        // 2. expect a cache hit or miss
        const cache = new CachePolicy(
            { method, headers: {} },
            {
                headers: {
                    expires: formatDate(1, 3600),
                },
            },
            { shared: false }
        );

        assert(cache.stale());
    }

    it('etag and expiration date in the future', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    etag: 'v1',
                    'last-modified': formatDate(-2, 3600),
                    expires: formatDate(1, 3600),
                },
            },
            { shared: false }
        );

        assert(cache.timeToLive() > 0);
    });

    it('client side no store', function() {
        const cache = new CachePolicy(
            {
                headers: {
                    'cache-control': 'no-store',
                },
            },
            {
                headers: {
                    'cache-control': 'max-age=60',
                },
            },
            { shared: false }
        );

        assert(!cache.storable());
    });

    it('request max age', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    'last-modified': formatDate(-2, 3600),
                    age: 60,
                    expires: formatDate(1, 3600),
                },
            },
            { shared: false }
        );

        assert(!cache.stale());
        assert(cache.age() >= 60);

        assert(
            cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'max-age=90',
                },
            })
        );

        assert(
            !cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'max-age=30',
                },
            })
        );
    });

    it('request min fresh', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    'cache-control': 'max-age=60',
                },
            },
            { shared: false }
        );

        assert(!cache.stale());

        assert(
            !cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'min-fresh=120',
                },
            })
        );

        assert(
            cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'min-fresh=10',
                },
            })
        );
    });

    it('request max stale', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    'cache-control': 'max-age=120',
                    age: 4*60,
                },
            },
            { shared: false }
        );

        assert(cache.stale());

        assert(
            cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'max-stale=180',
                },
            })
        );

        assert(
            cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'max-stale',
                },
            })
        );

        assert(
            !cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'max-stale=10',
                },
            })
        );
    });

    it('request max stale not honored with must revalidate', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    'cache-control': 'max-age=120, must-revalidate',
                    age: 360,
                },
            },
            { shared: false }
        );

        assert(cache.stale());

        assert(
            !cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'max-stale=180',
                },
            })
        );

        assert(
            !cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'max-stale',
                },
            })
        );
    });

    it('get headers deletes cached100 level warnings', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    warning: '199 test danger, 200 ok ok',
                },
            }
        );

        assert.equal('200 ok ok', cache.responseHeaders().warning);
    });

    it('do not cache partial response', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                status: 206,
                headers: {
                    'content-range': 'bytes 100-100/200',
                    'cache-control': 'max-age=60',
                },
            }
        );
        assert(!cache.storable());
    });

    function formatDate(delta, unit) {
        return new Date(Date.now() + delta * unit * 1000).toUTCString();
    }
});
