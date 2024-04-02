import CachePolicy from '../src';

describe('Satisfies', () => {
    test('when URLs match', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                status: 200,
                headers: { 'cache-control': 'max-age=2' },
            })
        );
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/')
            )
        ).toBeTruthy();
    });

    test('when expires is present', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                status: 302,
                headers: { expires: new Date(Date.now() + 2000).toUTCString() },
            })
        );
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/')
            )
        ).toBeTruthy();
    });

    test('not when URLs mismatch', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/foo'),
            new Response(null, {
                status: 200,
                headers: { 'cache-control': 'max-age=2' },
            })
        );
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/foo?bar')
            )
        ).toBeFalsy();
    });

    test('when methods match', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                status: 200,
                headers: { 'cache-control': 'max-age=2' },
            })
        );
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/')
            )
        ).toBeTruthy();
    });

    test('not when hosts mismatch', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/', { headers: { host: 'foo' } }),
            new Response(null, {
                status: 200,
                headers: { 'cache-control': 'max-age=2' },
            })
        );
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', { headers: { host: 'foo' } })
            )
        ).toBeTruthy();
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { host: 'foofoo' },
                })
            )
        ).toBeFalsy();
    });

    test('when methods match HEAD', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/', { method: 'HEAD' }),
            new Response(null, {
                status: 200,
                headers: { 'cache-control': 'max-age=2' },
            })
        );
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', { method: 'HEAD' })
            )
        ).toBeTruthy();
    });

    test('not when methods mismatch', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/', { method: 'POST', headers: {} }),
            new Response(null, {
                status: 200,
                headers: { 'cache-control': 'max-age=2' },
            })
        );
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/')
            )
        ).toBeFalsy();
    });

    test('not when methods mismatch HEAD', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/', { method: 'HEAD', headers: {} }),
            new Response(null, {
                status: 200,
                headers: { 'cache-control': 'max-age=2' },
            })
        );
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/')
            )
        ).toBeFalsy();
    });

    test('not when proxy revalidating', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                status: 200,
                headers: { 'cache-control': 'max-age=2, proxy-revalidate ' },
            })
        );
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/')
            )
        ).toBeFalsy();
    });

    test('when not a proxy revalidating', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                status: 200,
                headers: { 'cache-control': 'max-age=2, proxy-revalidate ' },
            }),
            { shared: false }
        );
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/')
            )
        ).toBeTruthy();
    });

    test('not when no-cache requesting', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, { headers: { 'cache-control': 'max-age=2' } })
        );
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { 'cache-control': 'fine' },
                })
            )
        ).toBeTruthy();
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { 'cache-control': 'no-cache' },
                })
            )
        ).toBeFalsy();
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { pragma: 'no-cache' },
                })
            )
        ).toBeFalsy();
    });
});
