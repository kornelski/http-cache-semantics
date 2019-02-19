import CachePolicy = require('..');

const req: CachePolicy.Request = { method: 'GET', headers: {} };

test('simple miss', () => {
    const cache = new CachePolicy(req, { headers: {} });
    expect(cache.stale()).toBeTruthy();
});

test('simple hit', () => {
    const cache = new CachePolicy(req, {
        headers: { 'cache-control': 'public, max-age=999999' },
    });
    expect(cache.stale()).toBeFalsy();
    expect(cache.maxAge()).toEqual(999999);
});

test('weird syntax', () => {
    const cache = new CachePolicy(req, {
        headers: { 'cache-control': ',,,,max-age =  456      ,' },
    });
    expect(cache.stale()).toBeFalsy();
    expect(cache.maxAge()).toEqual(456);

    const cache2 = CachePolicy.fromObject(
        JSON.parse(JSON.stringify(cache.toObject()))
    );
    expect(cache2).toBeInstanceOf(CachePolicy);
    expect(cache2.stale()).toBeFalsy();
    expect(cache2.maxAge()).toEqual(cache.maxAge());
});

test('quoted syntax', () => {
    const cache = new CachePolicy(req, {
        headers: { 'cache-control': '  max-age = "678"      ' },
    });
    expect(cache.stale()).toBeFalsy();
    expect(cache.maxAge()).toEqual(678);
});

test('IIS', () => {
    const cache = new CachePolicy(
        req,
        { headers: { 'cache-control': 'private, public, max-age=259200' } },
        { shared: false }
    );
    expect(cache.stale()).toBeFalsy();
    expect(cache.maxAge()).toEqual(259200);
});

test('pre-check tolerated', () => {
    const cc = 'pre-check=0, post-check=0, no-store, no-cache, max-age=100';
    const cache = new CachePolicy(req, {
        headers: { 'cache-control': cc },
    });
    expect(cache.stale()).toBeTruthy();
    expect(cache.storable()).toBeFalsy();
    expect(cache.maxAge()).toEqual(0);
    expect(cache.responseHeaders()['cache-control']).toEqual(cc);
});

test('pre-check poison', () => {
    const origCC =
        'pre-check=0, post-check=0, no-cache, no-store, max-age=100, custom, foo=bar';
    const res = {
        headers: { 'cache-control': origCC, pragma: 'no-cache' },
    };
    const cache = new CachePolicy(req, res, { ignoreCargoCult: true });
    expect(cache.stale()).toBeFalsy();
    expect(cache.storable()).toBeTruthy();
    expect(cache.maxAge()).toEqual(100);

    const cc = cache.responseHeaders()['cache-control'] as string;
    expect(cc).not.toContain('pre-check');
    expect(cc).not.toContain('post-check');
    expect(cc).not.toContain('no-store');

    expect(cc).toContain('max-age=100');
    expect(cc).toMatch(/custom(,|$)/);
    expect(cc).toContain('foo=bar');

    expect(res.headers['cache-control']).toEqual(origCC);
    expect(res.headers.pragma).toBeTruthy();
    expect(cache.responseHeaders().pragma).toBeFalsy();
});

test('pre-check poison undefined header', () => {
    const origCC = 'pre-check=0, post-check=0, no-cache, no-store';
    const expires = 'yesterday!';
    const res = {
        headers: {
            'cache-control': origCC,
            expires,
        },
    };
    const cache = new CachePolicy(req, res, { ignoreCargoCult: true });
    expect(cache.stale()).toBeTruthy();
    expect(cache.storable()).toBeTruthy();
    expect(cache.maxAge()).toEqual(0);

    expect(cache.responseHeaders()).not.toHaveProperty('cache-control');
    expect(res.headers).toHaveProperty('expires', expires);
    expect(cache.responseHeaders()).not.toHaveProperty('expires');
});

test('cache with expires', () => {
    const now = Date.now();
    const cache = new CachePolicy(req, {
        headers: {
            date: new Date(now).toUTCString(),
            expires: new Date(now + 2000).toUTCString(),
        },
    });
    expect(cache.stale()).toBeFalsy();
    expect(cache.maxAge()).toEqual(2);
});

test('cache with expires relative to date', () => {
    const now = Date.now();
    const cache = new CachePolicy(req, {
        headers: {
            date: new Date(now - 3000).toUTCString(),
            expires: new Date(now).toUTCString(),
        },
    });
    expect(cache.maxAge()).toEqual(3);
});

test('cache with expires always relative to date', () => {
    const now = Date.now();
    const cache = new CachePolicy(
        req,
        {
            headers: {
                date: new Date(now - 3000).toUTCString(),
                expires: new Date(now).toUTCString(),
            },
        },
        { trustServerDate: false }
    );
    expect(cache.maxAge()).toEqual(3);
});

test('cache expires no date', () => {
    const cache = new CachePolicy(req, {
        headers: {
            'cache-control': 'public',
            expires: new Date(Date.now() + 3600 * 1000).toUTCString(),
        },
    });
    expect(cache.stale()).toBeFalsy();
    expect(cache.maxAge()).toBeGreaterThan(3595);
    expect(cache.maxAge()).toBeLessThan(3605);
});

test('Ages', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);

    const cache = new CachePolicy(req, {
        headers: {
            age: '50',
            'cache-control': 'max-age=100',
        },
    });

    expect(cache.storable()).toBeTruthy();
    expect(cache.timeToLive()).toEqual(50 * 1000);
    expect(cache.stale()).toBeFalsy();

    now.mockReturnValue(now() + 48 * 1000);

    expect(cache.timeToLive()).toEqual(2 * 1000);
    expect(cache.stale()).toBeFalsy();

    now.mockReturnValue(now() + 5 * 1000);

    expect(cache.stale()).toBeTruthy();
    expect(cache.timeToLive()).toEqual(0);
});

test('Age can make stale', () => {
    const cache = new CachePolicy(req, {
        headers: {
            age: '101',
            'cache-control': 'max-age=100',
        },
    });
    expect(cache.stale()).toBeTruthy();
    expect(cache.storable()).toBeTruthy();
});

test('Age not always stale', () => {
    const cache = new CachePolicy(req, {
        headers: {
            age: '15',
            'cache-control': 'max-age=20',
        },
    });
    expect(cache.stale()).toBeFalsy();
    expect(cache.storable()).toBeTruthy();
});

test('Bogus age ignored', () => {
    const cache = new CachePolicy(req, {
        headers: {
            age: 'golden',
            'cache-control': 'max-age=20',
        },
    });
    expect(cache.stale()).toBeFalsy();
    expect(cache.storable()).toBeTruthy();
});

test('cache old files', () => {
    const cache = new CachePolicy(req, {
        headers: {
            date: new Date().toUTCString(),
            'last-modified': 'Mon, 07 Mar 2016 11:52:56 GMT',
        },
    });
    expect(cache.stale()).toBeFalsy();
    expect(cache.maxAge()).toBeGreaterThan(100);
});

test('immutable simple hit', () => {
    const cache = new CachePolicy(req, {
        headers: { 'cache-control': 'immutable, max-age=999999' },
    });
    expect(cache.stale()).toBeFalsy();
    expect(cache.maxAge()).toEqual(999999);
});

test('immutable can expire', () => {
    const cache = new CachePolicy(req, {
        headers: { 'cache-control': 'immutable, max-age=0' },
    });
    expect(cache.stale()).toBeTruthy();
    expect(cache.maxAge()).toEqual(0);
});

test('cache immutable files', () => {
    const cache = new CachePolicy(req, {
        headers: {
            'cache-control': 'immutable',
            date: new Date().toUTCString(),
            'last-modified': new Date().toUTCString(),
        },
    });
    expect(cache.stale()).toBeFalsy();
    expect(cache.maxAge()).toBeGreaterThan(100);
});

test('immutable can be off', () => {
    const cache = new CachePolicy(
        req,
        {
            headers: {
                'cache-control': 'immutable',
                date: new Date().toUTCString(),
                'last-modified': new Date().toUTCString(),
            },
        },
        { immutableMinTimeToLive: 0 }
    );
    expect(cache.stale()).toBeTruthy();
    expect(cache.maxAge()).toEqual(0);
});

test('pragma: no-cache', () => {
    const cache = new CachePolicy(req, {
        headers: {
            'last-modified': 'Mon, 07 Mar 2016 11:52:56 GMT',
            pragma: 'no-cache',
        },
    });
    expect(cache.stale()).toBeTruthy();
});

test('blank cache-control and pragma: no-cache', () => {
    const cache = new CachePolicy(req, {
        headers: {
            'cache-control': '',
            'last-modified': new Date().toUTCString(),
            pragma: 'no-cache',
        },
    });
    expect(cache.stale()).toBeFalsy();
});

test('no-store', () => {
    const cache = new CachePolicy(req, {
        headers: {
            'cache-control': 'no-store, public, max-age=1',
        },
    });
    expect(cache.stale()).toBeTruthy();
    expect(cache.maxAge()).toEqual(0);
});

test('observe private cache', () => {
    const privateHeader = {
        'cache-control': 'private, max-age=1234',
    };
    const proxyCache = new CachePolicy(req, { headers: privateHeader });
    expect(proxyCache.stale()).toBeTruthy();
    expect(proxyCache.maxAge()).toEqual(0);

    const uaCache = new CachePolicy(
        req,
        { headers: privateHeader },
        { shared: false }
    );
    expect(uaCache.stale()).toBeFalsy();
    expect(uaCache.maxAge()).toEqual(1234);
});

test("don't share cookies", () => {
    const cookieHeader = {
        'cache-control': 'max-age=99',
        'set-cookie': 'foo=bar',
    };
    const proxyCache = new CachePolicy(
        req,
        { headers: cookieHeader },
        { shared: true }
    );
    expect(proxyCache.stale()).toBeTruthy();
    expect(proxyCache.maxAge()).toEqual(0);

    const uaCache = new CachePolicy(
        req,
        { headers: cookieHeader },
        { shared: false }
    );
    expect(uaCache.stale()).toBeFalsy();
    expect(uaCache.maxAge()).toEqual(99);
});

test('do share cookies if immutable', () => {
    const cookieHeader = {
        'cache-control': 'immutable, max-age=99',
        'set-cookie': 'foo=bar',
    };
    const proxyCache = new CachePolicy(
        req,
        { headers: cookieHeader },
        { shared: true }
    );
    expect(proxyCache.stale()).toBeFalsy();
    expect(proxyCache.maxAge()).toEqual(99);
});

test('cache explicitly public cookie', () => {
    const cookieHeader = {
        'cache-control': 'max-age=5, public',
        'set-cookie': 'foo=bar',
    };
    const proxyCache = new CachePolicy(
        req,
        { headers: cookieHeader },
        { shared: true }
    );
    expect(proxyCache.stale()).toBeFalsy();
    expect(proxyCache.maxAge()).toEqual(5);
});

test('miss max-age=0', () => {
    const cache = new CachePolicy(req, {
        headers: {
            'cache-control': 'public, max-age=0',
        },
    });
    expect(cache.stale()).toBeTruthy();
    expect(cache.maxAge()).toEqual(0);
});

test('uncacheable 503', () => {
    const cache = new CachePolicy(req, {
        headers: {
            'cache-control': 'public, max-age=1000',
        },
        status: 503,
    });
    expect(cache.stale()).toBeTruthy();
    expect(cache.maxAge()).toEqual(0);
});

test('cacheable 301', () => {
    const cache = new CachePolicy(req, {
        headers: {
            'last-modified': 'Mon, 07 Mar 2016 11:52:56 GMT',
        },
        status: 301,
    });
    expect(cache.stale()).toBeFalsy();
});

test('uncacheable 303', () => {
    const cache = new CachePolicy(req, {
        headers: {
            'last-modified': 'Mon, 07 Mar 2016 11:52:56 GMT',
        },
        status: 303,
    });
    expect(cache.stale()).toBeTruthy();
    expect(cache.maxAge()).toEqual(0);
});

test('cacheable 303', () => {
    const cache = new CachePolicy(req, {
        headers: {
            'cache-control': 'max-age=1000',
        },
        status: 303,
    });
    expect(cache.stale()).toBeFalsy();
});

test('uncacheable 412', () => {
    const cache = new CachePolicy(req, {
        headers: {
            'cache-control': 'public, max-age=1000',
        },
        status: 412,
    });
    expect(cache.stale()).toBeTruthy();
    expect(cache.maxAge()).toEqual(0);
});

test('expired expires cached with max-age', () => {
    const cache = new CachePolicy(req, {
        headers: {
            'cache-control': 'public, max-age=9999',
            expires: 'Sat, 07 May 2016 15:35:18 GMT',
        },
    });
    expect(cache.stale()).toBeFalsy();
    expect(cache.maxAge()).toEqual(9999);
});

test('expired expires cached with s-maxage', () => {
    const sMaxAgeHeaders = {
        'cache-control': 'public, s-maxage=9999',
        expires: 'Sat, 07 May 2016 15:35:18 GMT',
    };
    const proxyCache = new CachePolicy(req, { headers: sMaxAgeHeaders });
    expect(proxyCache.stale()).toBeFalsy();
    expect(proxyCache.maxAge()).toEqual(9999);

    const uaCache = new CachePolicy(
        req,
        { headers: sMaxAgeHeaders },
        { shared: false }
    );
    expect(uaCache.stale()).toBeTruthy();
    expect(uaCache.maxAge()).toEqual(0);
});

test('max-age wins over future expires', () => {
    const cache = new CachePolicy(req, {
        headers: {
            'cache-control': 'public, max-age=333',
            expires: new Date(Date.now() + 3600 * 1000).toUTCString(),
        },
    });
    expect(cache.stale()).toBeFalsy();
    expect(cache.maxAge()).toEqual(333);
});

test('remove hop headers', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(10000);

    const res = {
        headers: {
            age: '10',
            'cache-control': 'public, max-age=333',
            connection: 'close, oompa, header',
            custom: 'header',
            date: 'now',
            oompa: 'lumpa',
            te: 'deflate',
        },
    };

    const cache = new CachePolicy(req, res);

    now.mockReturnValue(now() + 1005);

    const h = cache.responseHeaders();
    expect(h.connection).toBeFalsy();
    expect(h.te).toBeFalsy();
    expect(h.oompa).toBeFalsy();
    expect(h['cache-control']).toEqual('public, max-age=333');
    expect(h.date).not.toEqual('now');
    expect(h.custom).toEqual('header');
    expect(h.age).toEqual('11');
    expect(res.headers.age).toEqual('10');

    const cache2 = CachePolicy.fromObject(
        JSON.parse(JSON.stringify(cache.toObject()))
    );
    expect(cache2).toBeInstanceOf(CachePolicy);
    const h2 = cache2.responseHeaders();
    expect(h).toEqual(h2);
});
