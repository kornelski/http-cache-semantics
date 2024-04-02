import CachePolicy from '../src';

const req = new Request('http://localhost/', { method: 'GET', headers: {} });

describe('Response headers', () => {
    test('simple miss', () => {
        const cache = new CachePolicy(req, new Response());
        expect(cache.stale()).toBeTruthy();
    });

    test('simple hit', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: { 'cache-control': 'public, max-age=999999' },
            })
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.maxAge()).toBe(999999);
    });

    test('weird syntax', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: { 'cache-control': ',,,,max-age =  456      ,' },
            })
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.maxAge()).toBe(456);

        const cache2 = CachePolicy.fromObject(
            JSON.parse(JSON.stringify(cache.toObject()))
        );
        expect(cache2 instanceof CachePolicy).toBeTruthy();
        expect(cache2.stale()).toBeFalsy();
        expect(cache2.maxAge()).toBe(456);
    });

    test('quoted syntax', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: { 'cache-control': '  max-age = "678"      ' },
            })
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.maxAge()).toBe(678);
    });

    test('IIS', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: { 'cache-control': 'private, public, max-age=259200' },
            }),
            { shared: false }
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.maxAge()).toBe(259200);
    });

    test('pre-check tolerated', () => {
        const cc = 'pre-check=0, post-check=0, no-store, no-cache, max-age=100';
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: { 'cache-control': cc },
            })
        );
        expect(cache.stale()).toBeTruthy();
        expect(cache.storable()).toBeFalsy();
        expect(cache.maxAge()).toBe(0);
        expect(cache.responseHeaders().get('cache-control')).toBe(cc);
    });

    test('pre-check poison', () => {
        const origCC =
            'pre-check=0, post-check=0, no-cache, no-store, max-age=100, custom, foo=bar';
        const res = new Response(null, {
            headers: { 'cache-control': origCC, pragma: 'no-cache' },
        });
        const cache = new CachePolicy(req, res, { ignoreCargoCult: true });
        expect(cache.stale()).toBeFalsy();
        expect(cache.storable()).toBeTruthy();
        expect(cache.maxAge()).toBe(100);

        const cc = cache.responseHeaders().get('cache-control') ?? '';
        expect(/pre-check/.test(cc)).toBeFalsy();
        expect(/post-check/.test(cc)).toBeFalsy();
        expect(/no-store/.test(cc)).toBeFalsy();

        expect(/max-age=100/.test(cc)).toBeTruthy();
        expect(/custom(,|$)/.test(cc)).toBeTruthy();
        expect(/foo=bar/.test(cc)).toBeTruthy();

        expect(res.headers.get('cache-control')).toBe(origCC);
        expect(res.headers.get('pragma')).toBeDefined();
        expect(cache.responseHeaders().get('pragma')).toBe(null);
    });

    test('pre-check poison undefined header', () => {
        const origCC = 'pre-check=0, post-check=0, no-cache, no-store';
        const res = new Response(null, {
            headers: { 'cache-control': origCC, expires: 'yesterday!' },
        });
        const cache = new CachePolicy(req, res, { ignoreCargoCult: true });
        expect(cache.stale()).toBeTruthy();
        expect(cache.storable()).toBeTruthy();
        expect(cache.maxAge()).toBe(0);

        const cc = cache.responseHeaders().get('cache-control');
        expect(cc).toBe(null);

        expect(res.headers.has('expires')).toBeTruthy();
        expect(cache.responseHeaders().get('expires')).toBe(null);
    });

    test('cache with expires', () => {
        const now = Date.now();
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    date: new Date(now).toUTCString(),
                    expires: new Date(now + 2000).toUTCString(),
                },
            })
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.maxAge()).toBe(2);
    });

    test('cache with expires relative to date', () => {
        const now = Date.now();
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    date: new Date(now - 3000).toUTCString(),
                    expires: new Date(now).toUTCString(),
                },
            })
        );
        expect(cache.maxAge()).toBe(3);
    });

    test('cache with expires always relative to date', () => {
        const now = Date.now();
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    date: new Date(now - 3000).toUTCString(),
                    expires: new Date(now).toUTCString(),
                },
            }),
            // @ts-ignore
            { trustServerDate: false }
        );
        expect(cache.maxAge()).toBe(3);
    });

    test('cache expires no date', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    'cache-control': 'public',
                    expires: new Date(Date.now() + 3600 * 1000).toUTCString(),
                },
            })
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.maxAge()).toBeGreaterThan(3595);
        expect(cache.maxAge()).toBeLessThan(3605);
    });

    test('Ages', () => {
        let now = 1000;
        class TimeTravellingPolicy extends CachePolicy {
            now() {
                return now;
            }
        }
        const cache = new TimeTravellingPolicy(
            req,
            new Response(null, {
                headers: {
                    'cache-control': 'max-age=100',
                    age: '50',
                },
            })
        );
        expect(cache.storable()).toBeTruthy();

        expect(cache.timeToLive()).toBe(50 * 1000);
        expect(cache.stale()).toBeFalsy();
        now += 48 * 1000;
        expect(cache.timeToLive()).toBe(2 * 1000);
        expect(cache.stale()).toBeFalsy();
        now += 5 * 1000;
        expect(cache.stale()).toBeTruthy();
        expect(cache.timeToLive()).toBe(0);
    });

    test('Age can make stale', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    'cache-control': 'max-age=100',
                    age: '101',
                },
            })
        );
        expect(cache.stale()).toBeTruthy();
        expect(cache.storable()).toBeTruthy();
    });

    test('Age not always stale', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    'cache-control': 'max-age=20',
                    age: '15',
                },
            })
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.storable()).toBeTruthy();
    });

    test('Bogus age ignored', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    'cache-control': 'max-age=20',
                    age: 'golden',
                },
            })
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.storable()).toBeTruthy();
    });

    test('cache old files', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    date: new Date().toUTCString(),
                    'last-modified': 'Mon, 07 Mar 2016 11:52:56 GMT',
                },
            })
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.maxAge()).toBeGreaterThan(100);
    });

    test('immutable simple hit', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: { 'cache-control': 'immutable, max-age=999999' },
            })
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.maxAge()).toBe(999999);
    });

    test('immutable can expire', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: { 'cache-control': 'immutable, max-age=0' },
            })
        );
        expect(cache.stale()).toBeTruthy();
        expect(cache.maxAge()).toBe(0);
    });

    test('cache immutable files', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    date: new Date().toUTCString(),
                    'cache-control': 'immutable',
                    'last-modified': new Date().toUTCString(),
                },
            })
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.maxAge()).toBeGreaterThan(100);
    });

    test('immutable can be off', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    date: new Date().toUTCString(),
                    'cache-control': 'immutable',
                    'last-modified': new Date().toUTCString(),
                },
            }),
            { immutableMinTimeToLive: 0 }
        );
        expect(cache.stale()).toBeTruthy();
        expect(cache.maxAge()).toBe(0);
    });

    test('pragma: no-cache', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    pragma: 'no-cache',
                    'last-modified': 'Mon, 07 Mar 2016 11:52:56 GMT',
                },
            })
        );
        expect(cache.stale()).toBeTruthy();
    });

    test('blank cache-control and pragma: no-cache', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    'cache-control': '',
                    pragma: 'no-cache',
                    'last-modified': new Date(Date.now() - 10000).toUTCString(),
                },
            })
        );
        expect(cache.maxAge()).toBeGreaterThan(0);
        expect(cache.stale()).toBeFalsy();
    });

    test('no-store', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    'cache-control': 'no-store, public, max-age=1',
                },
            })
        );
        expect(cache.stale()).toBeTruthy();
        expect(cache.maxAge()).toBe(0);
    });

    test('observe private cache', () => {
        const privateHeader = {
            'cache-control': 'private, max-age=1234',
        };
        const proxyCache = new CachePolicy(
            req,
            new Response(null, new Response(null, { headers: privateHeader }))
        );
        expect(proxyCache.stale()).toBeTruthy();
        expect(proxyCache.maxAge()).toBe(0);

        const uaCache = new CachePolicy(
            req,
            new Response(null, { headers: privateHeader }),
            { shared: false }
        );
        expect(uaCache.stale()).toBeFalsy();
        expect(uaCache.maxAge()).toBe(1234);
    });

    test("don't share cookies", () => {
        const cookieHeader = {
            'set-cookie': 'foo=bar',
            'cache-control': 'max-age=99',
        };
        const proxyCache = new CachePolicy(
            req,
            new Response(null, { headers: cookieHeader }),
            { shared: true }
        );
        expect(proxyCache.stale()).toBeTruthy();
        expect(proxyCache.maxAge()).toBe(0);

        const uaCache = new CachePolicy(
            req,
            new Response(null, { headers: cookieHeader }),
            { shared: false }
        );
        expect(uaCache.stale()).toBeFalsy();
        expect(uaCache.maxAge()).toBe(99);
    });

    test('do share cookies if immutable', () => {
        const cookieHeader = {
            'set-cookie': 'foo=bar',
            'cache-control': 'immutable, max-age=99',
        };
        const proxyCache = new CachePolicy(
            req,
            new Response(null, { headers: cookieHeader }),
            { shared: true }
        );
        expect(proxyCache.stale()).toBeFalsy();
        expect(proxyCache.maxAge()).toBe(99);
    });

    test('cache explicitly public cookie', () => {
        const cookieHeader = {
            'set-cookie': 'foo=bar',
            'cache-control': 'max-age=5, public',
        };
        const proxyCache = new CachePolicy(
            req,
            new Response(null, { headers: cookieHeader }),
            { shared: true }
        );
        expect(proxyCache.stale()).toBeFalsy();
        expect(proxyCache.maxAge()).toBe(5);
    });

    test('miss max-age=0', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    'cache-control': 'public, max-age=0',
                },
            })
        );
        expect(cache.stale()).toBeTruthy();
        expect(cache.maxAge()).toBe(0);
    });

    test('uncacheable 503', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                status: 503,
                headers: {
                    'cache-control': 'public, max-age=1000',
                },
            })
        );
        expect(cache.stale()).toBeTruthy();
        expect(cache.maxAge()).toBe(0);
    });

    test('cacheable 301', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                status: 301,
                headers: {
                    'last-modified': 'Mon, 07 Mar 2016 11:52:56 GMT',
                },
            })
        );
        expect(cache.stale()).toBeFalsy();
    });

    test('uncacheable 303', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                status: 303,
                headers: {
                    'last-modified': 'Mon, 07 Mar 2016 11:52:56 GMT',
                },
            })
        );
        expect(cache.stale()).toBeTruthy();
        expect(cache.maxAge()).toBe(0);
    });

    test('cacheable 303', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                status: 303,
                headers: {
                    'cache-control': 'max-age=1000',
                },
            })
        );
        expect(cache.stale()).toBeFalsy();
    });

    test('uncacheable 412', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                status: 412,
                headers: {
                    'cache-control': 'public, max-age=1000',
                },
            })
        );
        expect(cache.stale()).toBeTruthy();
        expect(cache.maxAge()).toBe(0);
    });

    test('expired expires cached with max-age', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    'cache-control': 'public, max-age=9999',
                    expires: 'Sat, 07 May 2016 15:35:18 GMT',
                },
            })
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.maxAge()).toBe(9999);
    });

    test('expired expires cached with s-maxage', () => {
        const sMaxAgeHeaders = {
            'cache-control': 'public, s-maxage=9999',
            expires: 'Sat, 07 May 2016 15:35:18 GMT',
        };
        const proxyCache = new CachePolicy(
            req,
            new Response(null, new Response(null, { headers: sMaxAgeHeaders }))
        );
        expect(proxyCache.stale()).toBeFalsy();
        expect(proxyCache.maxAge()).toBe(9999);

        const uaCache = new CachePolicy(
            req,
            new Response(null, { headers: sMaxAgeHeaders }),
            { shared: false }
        );
        expect(uaCache.stale()).toBeTruthy();
        expect(uaCache.maxAge()).toBe(0);
    });

    test('max-age wins over future expires', () => {
        const cache = new CachePolicy(
            req,
            new Response(null, {
                headers: {
                    'cache-control': 'public, max-age=333',
                    expires: new Date(Date.now() + 3600 * 1000).toUTCString(),
                },
            })
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.maxAge()).toBe(333);
    });

    test('remove hop headers', () => {
        let now = 10000;
        class TimeTravellingPolicy extends CachePolicy {
            now() {
                return now;
            }
        }

        const res = new Response(null, {
            headers: {
                te: 'deflate',
                date: 'now',
                custom: 'header',
                oompa: 'lumpa',
                connection: 'close, oompa, header',
                age: '10',
                'cache-control': 'public, max-age=333',
            },
        });
        const cache = new TimeTravellingPolicy(req, res);

        now += 1005;
        const h = cache.responseHeaders();
        expect(h.get('connection')).toBe(null);
        expect(h.get('te')).toBe(null);
        expect(h.get('oompa')).toBe(null);
        expect(h.get('cache-control')).toBe('public, max-age=333');
        expect(h.get('date')).not.toBe('now');
        expect(h.get('custom')).toBe('header');
        expect(h.get('age')).toBe('11');
        expect(res.headers.get('age')).toBe('10');

        const cache2 = TimeTravellingPolicy.fromObject(
            JSON.parse(JSON.stringify(cache.toObject()))
        );
        expect(cache2 instanceof TimeTravellingPolicy).toBeTruthy();
        const h2 = cache2.responseHeaders();
        expect(h).toEqual(h2);
    });
});
