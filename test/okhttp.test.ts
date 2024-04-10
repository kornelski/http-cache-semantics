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

import CachePolicy from '../src';

describe('okhttp tests', () => {
    test('response caching by response code', () => {
        // Test each documented HTTP/1.1 code, plus the first unused value in each range.
        // http://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html

        // NOTE: RangeError: init["status"] must be in the range of 200 to 599, inclusive.
        // assertCached(false, 100);
        // assertCached(false, 101);
        // assertCached(false, 102);

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

    function assertCached(shouldPut: boolean, responseCode: number) {
        const mockResponse = new Response(
            responseCode == 204 || responseCode == 205 || responseCode === 304
                ? null
                : 'ABCDE',
            {
                headers: {
                    'last-modified': formatDate(-1, 3600),
                    expires: formatDate(1, 3600),
                    'www-authenticate': 'challenge',
                },
                status: responseCode,
            }
        );
        if (responseCode == 407) {
            mockResponse.headers.set(
                'proxy-authenticate',
                'Basic realm="protected area"'
            );
        } else if (responseCode == 401) {
            mockResponse.headers.set(
                'www-authenticate',
                'Basic realm="protected area"'
            );
        }

        const request = new Request('http://localhost/', {
            headers: {},
        });

        const cache = new CachePolicy(request, mockResponse, { shared: false });

        expect(cache.storable()).toEqual(shouldPut);
    }

    test('default expiration date fully cached for less than24 hours', () => {
        //      last modified: 105 seconds ago
        //             served:   5 seconds ago
        //   default lifetime: (105 - 5) / 10 = 10 seconds
        //            expires:  10 seconds from served date = 5 seconds from now
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response('A', {
                headers: {
                    'last-modified': formatDate(-105, 1),
                    date: formatDate(-5, 1),
                },
            }),
            { shared: false }
        );

        expect(cache.timeToLive()).toBeGreaterThan(4000);
    });

    test('default expiration date fully cached for more than24 hours', () => {
        //      last modified: 105 days ago
        //             served:   5 days ago
        //   default lifetime: (105 - 5) / 10 = 10 days
        //            expires:  10 days from served date = 5 days from now
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response('A', {
                headers: {
                    'last-modified': formatDate(-105, 3600 * 24),
                    date: formatDate(-5, 3600 * 24),
                },
            }),
            { shared: false }
        );

        expect(cache.maxAge()).toBeGreaterThanOrEqual(10 * 3600 * 24);
        expect(cache.timeToLive() + 1000).toBeGreaterThanOrEqual(5 * 3600 * 24);
    });

    test('max age in the past with date header but no last modified header', () => {
        // Chrome interprets max-age relative to the local clock. Both our cache
        // and Firefox both use the earlier of the local and server's clock.
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                headers: {
                    date: formatDate(-120, 1),
                    'cache-control': 'max-age=60',
                },
            }),
            { shared: false }
        );

        expect(cache.stale()).toBeFalsy();
    });

    test('maxAge timetolive', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                headers: {
                    date: formatDate(120, 1),
                    'cache-control': 'max-age=60',
                },
            }),
            { shared: false }
        );
        const now = Date.now();
        cache.now = () => now;

        expect(cache.stale()).toBeFalsy();
        const ttl = cache.timeToLive();
        // NOTE: It is normal for the TTL value to be equal to 59999.
        // This may be a problem with the time accuracy of the test environment.
        expect(ttl === 60000 || ttl === 59999).toEqual(true);
    });

    test('stale-if-error timetolive', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                headers: {
                    date: formatDate(120, 1),
                    'cache-control': 'max-age=60, stale-if-error=200',
                },
            }),
            { shared: false }
        );

        expect(cache.stale()).toBeFalsy();
        const ttl = cache.timeToLive();
        // NOTE: It is normal for the TTL value to be equal to 259999.
        // This may be a problem with the time accuracy of the test environment.
        expect(ttl === 260000 || ttl === 259999).toBe(true);
    });

    test('stale-while-revalidate timetolive', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                headers: {
                    date: formatDate(120, 1),
                    'cache-control': 'max-age=60, stale-while-revalidate=200',
                },
            }),
            { shared: false }
        );

        expect(cache.stale()).toBeFalsy();
        const ttl = cache.timeToLive();
        // NOTE: It is normal for the TTL value to be equal to 259999.
        // This may be a problem with the time accuracy of the test environment.
        expect(ttl === 260000 || ttl === 259999).toBe(true);
    });

    test('max age preferred over lower shared max age', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                headers: {
                    date: formatDate(-2, 60),
                    'cache-control': 's-maxage=60, max-age=180',
                },
            }),
            { shared: false }
        );

        expect(cache.maxAge()).toBe(180);
    });

    test('max age preferred over higher max age', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                headers: {
                    age: '360',
                    'cache-control': 's-maxage=60, max-age=180',
                },
            }),
            { shared: false }
        );

        expect(cache.stale()).toBeTruthy();
    });

    test('request method options is not cached', () => {
        testRequestMethodNotCached('OPTIONS');
    });

    test('request method put is not cached', () => {
        testRequestMethodNotCached('PUT');
    });

    test('request method delete is not cached', () => {
        testRequestMethodNotCached('DELETE');
    });

    // Error: 'TRACE' HTTP method is unsupported.
    // test('request method trace is not cached', () => {
    //     testRequestMethodNotCached('TRACE');
    // });

    function testRequestMethodNotCached(method: string) {
        // 1. seed the cache (potentially)
        // 2. expect a cache hit or miss
        const cache = new CachePolicy(
            new Request('http://localhost/', { method, headers: {} }),
            new Response(null, {
                headers: {
                    expires: formatDate(1, 3600),
                },
            }),
            { shared: false }
        );

        expect(cache.stale()).toBeTruthy();
    }

    test('etag and expiration date in the future', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                headers: {
                    etag: 'v1',
                    'last-modified': formatDate(-2, 3600),
                    expires: formatDate(1, 3600),
                },
            }),
            { shared: false }
        );

        expect(cache.timeToLive()).toBeGreaterThan(0);
    });

    test('client side no store', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/', {
                headers: {
                    'cache-control': 'no-store',
                },
            }),
            new Response(null, {
                headers: {
                    'cache-control': 'max-age=60',
                },
            }),
            { shared: false }
        );

        expect(cache.storable()).toBeFalsy();
    });

    test('request max age', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                headers: {
                    'last-modified': formatDate(-2, 3600),
                    age: '60',
                    expires: formatDate(1, 3600),
                },
            }),
            { shared: false }
        );

        expect(cache.stale()).toBeFalsy();
        expect(cache.age()).toBeGreaterThanOrEqual(60);

        expect(
            cache.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: {
                        'cache-control': 'max-age=90',
                    },
                })
            )
        ).toBeTruthy();

        expect(
            cache.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: {
                        'cache-control': 'max-age=30',
                    },
                })
            )
        ).toBeFalsy();
    });

    test('request min fresh', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                headers: {
                    'cache-control': 'max-age=60',
                },
            }),
            { shared: false }
        );

        expect(cache.stale()).toBeFalsy();

        expect(
            cache.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: {
                        'cache-control': 'min-fresh=120',
                    },
                })
            )
        ).toBeFalsy();

        expect(
            cache.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: {
                        'cache-control': 'min-fresh=10',
                    },
                })
            )
        ).toBeTruthy();
    });

    test('request max stale', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                headers: {
                    'cache-control': 'max-age=120',
                    age: String(4 * 60),
                },
            }),
            { shared: false }
        );

        expect(cache.stale()).toBeTruthy();

        expect(
            cache.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: {
                        'cache-control': 'max-stale=180',
                    },
                })
            )
        ).toBeTruthy();

        expect(
            cache.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: {
                        'cache-control': 'max-stale',
                    },
                })
            )
        ).toBeTruthy();

        expect(
            cache.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: {
                        'cache-control': 'max-stale=10',
                    },
                })
            )
        ).toBeFalsy();
    });

    test('request max stale not honored with must revalidate', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                headers: {
                    'cache-control': 'max-age=120, must-revalidate',
                    age: '360',
                },
            }),
            { shared: false }
        );

        expect(cache.stale()).toBeTruthy();

        expect(
            cache.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: {
                        'cache-control': 'max-stale=180',
                    },
                })
            )
        ).toBeFalsy();

        expect(
            cache.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: {
                        'cache-control': 'max-stale',
                    },
                })
            )
        ).toBeFalsy();
    });

    test('get headers deletes cached100 level warnings', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                headers: {
                    warning: '199 test danger, 200 ok ok',
                },
            })
        );

        expect(cache.responseHeaders().get('warning')).toBe('200 ok ok');
    });

    test('do not cache partial response', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                status: 206,
                headers: {
                    'content-range': 'bytes 100-100/200',
                    'cache-control': 'max-age=60',
                },
            })
        );
        expect(cache.storable()).toBeFalsy();
    });

    function formatDate(delta: number, unit: number) {
        return new Date(Date.now() + delta * unit * 1000).toUTCString();
    }
});
