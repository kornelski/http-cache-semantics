import CachePolicy from '../src';

describe('Vary', () => {
    test('Basic', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/', { headers: { weather: 'nice' } }),
            new Response(null, {
                headers: { 'cache-control': 'max-age=5', vary: 'weather' },
            })
        );

        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { weather: 'nice' },
                })
            )
        ).toBeTruthy();
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { weather: 'bad' },
                })
            )
        ).toBeFalsy();
    });

    test("* doesn't match", () => {
        const policy = new CachePolicy(
            new Request('http://localhost/', { headers: { weather: 'ok' } }),
            new Response(null, {
                headers: { 'cache-control': 'max-age=5', vary: '*' },
            })
        );

        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', { headers: { weather: 'ok' } })
            )
        ).toBeFalsy();
    });

    test('* is stale', () => {
        const policy1 = new CachePolicy(
            new Request('http://localhost/', { headers: { weather: 'ok' } }),
            new Response(null, {
                headers: { 'cache-control': 'public,max-age=99', vary: '*' },
            })
        );
        const policy2 = new CachePolicy(
            new Request('http://localhost/', { headers: { weather: 'ok' } }),
            new Response(null, {
                headers: {
                    'cache-control': 'public,max-age=99',
                    vary: 'weather',
                },
            })
        );

        expect(policy1.stale()).toBeTruthy();
        expect(policy2.stale()).toBeFalsy();
    });

    test('Values are case-sensitive', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/', { headers: { weather: 'BAD' } }),
            new Response(null, {
                headers: { 'cache-control': 'max-age=5', vary: 'Weather' },
            })
        );

        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { weather: 'BAD' },
                })
            )
        ).toBeTruthy();
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { weather: 'bad' },
                })
            )
        ).toBeFalsy();
    });

    test('Irrelevant headers ignored', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/', { headers: { weather: 'nice' } }),
            new Response(null, {
                headers: { 'cache-control': 'max-age=5', vary: 'moon-phase' },
            })
        );

        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { weather: 'bad' },
                })
            )
        ).toBeTruthy();
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { sun: 'shining' },
                })
            )
        ).toBeTruthy();
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { 'moon-phase': 'full' },
                })
            )
        ).toBeFalsy();
    });

    test('Absence is meaningful', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/', { headers: { weather: 'nice' } }),
            new Response(null, {
                headers: {
                    'cache-control': 'max-age=5',
                    vary: 'moon-phase, weather',
                },
            })
        );

        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { weather: 'nice' },
                })
            )
        ).toBeTruthy();
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { weather: 'nice', 'moon-phase': '' },
                })
            )
        ).toBeFalsy();
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', { headers: {} })
            )
        ).toBeFalsy();
    });

    test('All values must match', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/', {
                headers: { sun: 'shining', weather: 'nice' },
            }),
            new Response(null, {
                headers: { 'cache-control': 'max-age=5', vary: 'weather, sun' },
            })
        );

        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { sun: 'shining', weather: 'nice' },
                })
            )
        ).toBeTruthy();
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { sun: 'shining', weather: 'bad' },
                })
            )
        ).toBeFalsy();
    });

    test('Whitespace is OK', () => {
        const policy = new CachePolicy(
            new Request('http://localhost/', {
                headers: { sun: 'shining', weather: 'nice' },
            }),
            new Response(null, {
                headers: {
                    'cache-control': 'max-age=5',
                    vary: '    weather       ,     sun     ',
                },
            })
        );

        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { sun: 'shining', weather: 'nice' },
                })
            )
        ).toBeTruthy();
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { weather: 'nice' },
                })
            )
        ).toBeFalsy();
        expect(
            policy.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { sun: 'shining' },
                })
            )
        ).toBeFalsy();
    });

    test('Order is irrelevant', () => {
        const policy1 = new CachePolicy(
            new Request('http://localhost/', {
                headers: { sun: 'shining', weather: 'nice' },
            }),
            new Response(null, {
                headers: { 'cache-control': 'max-age=5', vary: 'weather, sun' },
            })
        );
        const policy2 = new CachePolicy(
            new Request('http://localhost/', {
                headers: { sun: 'shining', weather: 'nice' },
            }),
            new Response(null, {
                headers: { 'cache-control': 'max-age=5', vary: 'sun, weather' },
            })
        );

        expect(
            policy1.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { weather: 'nice', sun: 'shining' },
                })
            )
        ).toBeTruthy();
        expect(
            policy1.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { sun: 'shining', weather: 'nice' },
                })
            )
        ).toBeTruthy();
        expect(
            policy2.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { weather: 'nice', sun: 'shining' },
                })
            )
        ).toBeTruthy();
        expect(
            policy2.satisfiesWithoutRevalidation(
                new Request('http://localhost/', {
                    headers: { sun: 'shining', weather: 'nice' },
                })
            )
        ).toBeTruthy();
    });
});
