import CachePolicy from '../src';

const publicCacheableResponse = new Response(null, {
    headers: { 'cache-control': 'public, max-age=222' },
});
const cacheableResponse = new Response(null, {
    headers: { 'cache-control': 'max-age=111' },
});

describe('Request properties', () => {
    test('No store kills cache', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/', {
                method: 'GET',
                headers: { 'cache-control': 'no-store' },
            }),
            publicCacheableResponse
        );
        expect(cache.stale()).toBeTruthy();
        expect(cache.storable()).toBeFalsy();
    });

    test('POST not cacheable by default', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/', { method: 'POST', headers: {} }),
            new Response(null, { headers: { 'cache-control': 'public' } })
        );
        expect(cache.stale()).toBeTruthy();
        expect(cache.storable()).toBeFalsy();
    });

    test('POST cacheable explicitly', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/', { method: 'POST', headers: {} }),
            publicCacheableResponse
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.storable()).toBeTruthy();
    });

    test('Public cacheable auth is OK', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/', {
                method: 'GET',
                headers: { authorization: 'test' },
            }),
            publicCacheableResponse
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.storable()).toBeTruthy();
    });

    test('Proxy cacheable auth is OK', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/', {
                method: 'GET',
                headers: { authorization: 'test' },
            }),
            new Response(null, {
                headers: { 'cache-control': 'max-age=0,s-maxage=12' },
            })
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.storable()).toBeTruthy();

        const cache2 = CachePolicy.fromObject(
            JSON.parse(JSON.stringify(cache.toObject()))
        );
        expect(cache2 instanceof CachePolicy).toBeTruthy();
        expect(cache2.stale()).toBeFalsy();
        expect(cache2.storable()).toBeTruthy();
    });

    test('Private auth is OK', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/', {
                method: 'GET',
                headers: { authorization: 'test' },
            }),
            cacheableResponse,
            { shared: false }
        );
        expect(cache.stale()).toBeFalsy();
        expect(cache.storable()).toBeTruthy();
    });

    test('Revalidated auth is OK', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/', {
                headers: { authorization: 'test' },
            }),
            new Response(null, {
                headers: { 'cache-control': 'max-age=88,must-revalidate' },
            })
        );
        expect(cache.storable()).toBeTruthy();
    });

    test('Auth prevents caching by default', () => {
        const cache = new CachePolicy(
            new Request('http:localhost/', {
                method: 'GET',
                headers: { authorization: 'test' },
            }),
            cacheableResponse
        );
        expect(cache.stale()).toBeTruthy();
        expect(cache.storable()).toBeFalsy();
    });
});
