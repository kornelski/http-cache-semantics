import CachePolicy = require('..');
import { HttpMethod, IResponse, IResponseHeaders } from '../types';

test.each([
    // Test each documented HTTP/1.1 code, plus the first unused value in each range.
    // http://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html
    [false, 100],
    [false, 101],
    [false, 102],
    [true, 200],
    [false, 201],
    [false, 202],
    [true, 203],
    [true, 204],
    [false, 205],
    [false, 206], // Electing to not cache partial responses
    [false, 207],
    [true, 300],
    [true, 301],
    [true, 302],
    [true, 303],
    [false, 304],
    [false, 305],
    [false, 306],
    [true, 307],
    [true, 308],
    [false, 400],
    [false, 401],
    [false, 402],
    [false, 403],
    [true, 404],
    [true, 405],
    [false, 406],
    [false, 408],
    [false, 409],
    // the HTTP spec permits caching 410s, but the RI doesn't.
    [true, 410],
    [false, 411],
    [false, 412],
    [false, 413],
    [true, 414],
    [false, 415],
    [false, 416],
    [false, 417],
    [false, 418],
    [false, 429],

    [false, 500],
    [true, 501],
    [false, 502],
    [false, 503],
    [false, 504],
    [false, 505],
    [false, 506],
])('storable is %s for response code %s', (shouldPut, responseCode) => {
    const headers: IResponseHeaders = {
        expires: formatDate(1, 3600),
        'last-modified': formatDate(-1, 3600),
        'www-authenticate': 'challenge',
    };

    const mockResponse: IResponse = {
        body: 'ABCDE',
        headers,
        status: responseCode,
    };

    if (responseCode === 407) {
        headers['proxy-authenticate'] = 'Basic realm="protected area"';
    } else if (responseCode === 401) {
        headers['www-authenticate'] = 'Basic realm="protected area"';
    } else if (responseCode === 204 || responseCode === 205) {
        mockResponse.body = ''; // We forbid bodies for 204 and 205.
    }

    const request = { url: '/', headers: {} };

    const cache = new CachePolicy(request, mockResponse, {
        shared: false,
    });

    expect(shouldPut).toEqual(cache.storable());
});

test('default expiration date fully cached for less than 24 hours', () => {
    //      last modified: 105 seconds ago
    //             served:   5 seconds ago
    //   default lifetime: (105 - 5) / 10 = 10 seconds
    //            expires:  10 seconds from served date = 5 seconds from now
    const cache = new CachePolicy(
        { headers: {} },
        {
            body: 'A',
            headers: {
                date: formatDate(-5, 1),
                'last-modified': formatDate(-105, 1),
            },
        },
        { shared: false }
    );

    expect(cache.timeToLive()).toBeGreaterThan(4000);
});

test('default expiration date fully cached for morethan 24 hours', () => {
    //      last modified: 105 days ago
    //             served:   5 days ago
    //   default lifetime: (105 - 5) / 10 = 10 days
    //            expires:  10 days from served date = 5 days from now
    const cache = new CachePolicy(
        { headers: {} },
        {
            body: 'A',
            headers: {
                date: formatDate(-5, 3600 * 24),
                'last-modified': formatDate(-105, 3600 * 24),
            },
        },
        { shared: false }
    );

    expect(cache.maxAge()).toBeGreaterThanOrEqual(10 * 3600 * 24);
    expect(cache.timeToLive() + 1000).toBeGreaterThanOrEqual(5 * 3600 * 24);
});

test('max age in the past with date header but no last modified header', () => {
    // Chrome interprets max-age relative to the local clock. Both our cache
    // and Firefox both use the earlier of the local and server's clock.
    const cache = new CachePolicy(
        { headers: {} },
        {
            headers: {
                'cache-control': 'max-age=60',
                date: formatDate(-120, 1),
            },
        },
        { shared: false }
    );

    expect(cache.stale()).toBeTruthy();
});

test('max age preferred over lower shared max age', () => {
    const cache = new CachePolicy(
        { headers: {} },
        {
            headers: {
                'cache-control': 's-maxage=60, max-age=180',
                date: formatDate(-2, 60),
            },
        },
        { shared: false }
    );

    expect(cache.maxAge()).toEqual(180);
});

test('max age preferred over higher max age', () => {
    const cache = new CachePolicy(
        { headers: {} },
        {
            headers: {
                'cache-control': 's-maxage=60, max-age=180',
                date: formatDate(-3, 60),
            },
        },
        { shared: false }
    );

    expect(cache.stale()).toBeTruthy();
});

test.each([['OPTIONS', 'PUT', 'DELETE', 'TRACE']])(
    '%s is not cached',
    (method: HttpMethod) => {
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

        expect(cache.stale()).toBeTruthy();
    }
);

test('etag and expiration date in the future', () => {
    const cache = new CachePolicy(
        { headers: {} },
        {
            headers: {
                etag: 'v1',
                expires: formatDate(1, 3600),
                'last-modified': formatDate(-2, 3600),
            },
        },
        { shared: false }
    );

    expect(cache.timeToLive()).toBeGreaterThan(0);
});

test('client side no store', () => {
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

    expect(cache.storable()).toBeFalsy();
});

test('request max age', () => {
    const cache = new CachePolicy(
        { headers: {} },
        {
            headers: {
                date: formatDate(-1, 60),
                expires: formatDate(1, 3600),
                'last-modified': formatDate(-2, 3600),
            },
        },
        { shared: false }
    );

    expect(cache.stale()).toBeFalsy();
    expect(cache.age()).toBeGreaterThanOrEqual(60);

    expect(
        cache.satisfiesWithoutRevalidation({
            headers: {
                'cache-control': 'max-age=90',
            },
        })
    ).toBeTruthy();

    expect(
        cache.satisfiesWithoutRevalidation({
            headers: {
                'cache-control': 'max-age=30',
            },
        })
    ).toBeFalsy();
});

test('request min fresh', () => {
    const cache = new CachePolicy(
        { headers: {} },
        {
            headers: {
                'cache-control': 'max-age=60',
            },
        },
        { shared: false }
    );

    expect(cache.stale()).toBeFalsy();

    expect(
        cache.satisfiesWithoutRevalidation({
            headers: {
                'cache-control': 'min-fresh=120',
            },
        })
    ).toBeFalsy();

    expect(
        cache.satisfiesWithoutRevalidation({
            headers: {
                'cache-control': 'min-fresh=10',
            },
        })
    ).toBeTruthy();
});

test('request max stale', () => {
    const cache = new CachePolicy(
        { headers: {} },
        {
            headers: {
                'cache-control': 'max-age=120',
                date: formatDate(-4, 60),
            },
        },
        { shared: false }
    );

    expect(cache.stale()).toBeTruthy();

    expect(
        cache.satisfiesWithoutRevalidation({
            headers: {
                'cache-control': 'max-stale=180',
            },
        })
    ).toBeTruthy();

    expect(
        cache.satisfiesWithoutRevalidation({
            headers: {
                'cache-control': 'max-stale',
            },
        })
    ).toBeTruthy();

    expect(
        cache.satisfiesWithoutRevalidation({
            headers: {
                'cache-control': 'max-stale=10',
            },
        })
    ).toBeFalsy();
});

test('request max stale not honored with must revalidate', () => {
    const cache = new CachePolicy(
        { headers: {} },
        {
            headers: {
                'cache-control': 'max-age=120, must-revalidate',
                date: formatDate(-4, 60),
            },
        },
        { shared: false }
    );

    expect(cache.stale()).toBeTruthy();

    expect(
        cache.satisfiesWithoutRevalidation({
            headers: {
                'cache-control': 'max-stale=180',
            },
        })
    ).toBeFalsy();

    expect(
        cache.satisfiesWithoutRevalidation({
            headers: {
                'cache-control': 'max-stale',
            },
        })
    ).toBeFalsy();
});

test('get headers deletes cached 100 level warnings', () => {
    const okok = '200 ok ok';

    const cache = new CachePolicy(
        { headers: {} },
        {
            headers: {
                warning: `199 test danger, ${okok}`,
            },
        }
    );

    expect(cache.responseHeaders().warning).toEqual(okok);
});

test('do not cache partial response', () => {
    const cache = new CachePolicy(
        { headers: {} },
        {
            headers: {
                'cache-control': 'max-age=60',
                'content-range': 'bytes 100-100/200',
            },
            status: 206,
        }
    );

    expect(cache.storable()).toBeFalsy();
});

function formatDate(delta: number, unit: number) {
    return new Date(Date.now() + delta * unit * 1000).toUTCString();
}
