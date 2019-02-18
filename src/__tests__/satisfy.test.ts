import CachePolicy = require('..');

test('when URLs match', () => {
    const policy = new CachePolicy(
        { url: '/', headers: {} },
        { status: 200, headers: { 'cache-control': 'max-age=2' } }
    );
    expect(
        policy.satisfiesWithoutRevalidation({ url: '/', headers: {} })
    ).toBeTruthy();
});

test('when expires is present', () => {
    const policy = new CachePolicy(
        { headers: {} },
        {
            headers: {
                expires: new Date(Date.now() + 2000).toUTCString(),
            },
            status: 302,
        }
    );
    expect(policy.satisfiesWithoutRevalidation({ headers: {} })).toBeTruthy();
});

test('not when URLs mismatch', () => {
    const policy = new CachePolicy(
        { url: '/foo', headers: {} },
        { status: 200, headers: { 'cache-control': 'max-age=2' } }
    );
    expect(
        policy.satisfiesWithoutRevalidation({
            headers: {},
            url: '/foo?bar',
        })
    ).toBeFalsy();
});

test('when methods match', () => {
    const policy = new CachePolicy(
        { method: 'GET', headers: {} },
        { status: 200, headers: { 'cache-control': 'max-age=2' } }
    );
    expect(
        policy.satisfiesWithoutRevalidation({ method: 'GET', headers: {} })
    ).toBeTruthy();
});

test('not when hosts mismatch', () => {
    const policy = new CachePolicy(
        { headers: { host: 'foo' } },
        { status: 200, headers: { 'cache-control': 'max-age=2' } }
    );

    expect(
        policy.satisfiesWithoutRevalidation({ headers: { host: 'foo' } })
    ).toBeTruthy();

    expect(
        policy.satisfiesWithoutRevalidation({
            headers: { host: 'foofoo' },
        })
    ).toBeFalsy();
});

test('when methods match HEAD', () => {
    const policy = new CachePolicy(
        { method: 'HEAD', headers: {} },
        { status: 200, headers: { 'cache-control': 'max-age=2' } }
    );

    expect(
        policy.satisfiesWithoutRevalidation({ method: 'HEAD', headers: {} })
    ).toBeTruthy();
});

test('not when methods mismatch', () => {
    const policy = new CachePolicy(
        { method: 'POST', headers: {} },
        { status: 200, headers: { 'cache-control': 'max-age=2' } }
    );

    expect(
        policy.satisfiesWithoutRevalidation({ method: 'GET', headers: {} })
    ).toBeFalsy();
});

test('not when methods mismatch HEAD', () => {
    const policy = new CachePolicy(
        { method: 'HEAD', headers: {} },
        { status: 200, headers: { 'cache-control': 'max-age=2' } }
    );

    expect(
        policy.satisfiesWithoutRevalidation({ method: 'GET', headers: {} })
    ).toBeFalsy();
});

test('not when proxy revalidating', () => {
    const policy = new CachePolicy(
        { headers: {} },
        {
            headers: {
                'cache-control': 'max-age=2, proxy-revalidate ',
            },
            status: 200,
        }
    );
    expect(policy.satisfiesWithoutRevalidation({ headers: {} })).toBeFalsy();
});

test('when not a proxy revalidating', () => {
    const policy = new CachePolicy(
        { headers: {} },
        {
            headers: { 'cache-control': 'max-age=2, proxy-revalidate ' },
            status: 200,
        },
        { shared: false }
    );
    expect(policy.satisfiesWithoutRevalidation({ headers: {} })).toBeTruthy();
});

test('not when no-cache requesting', () => {
    const policy = new CachePolicy(
        { headers: {} },
        { headers: { 'cache-control': 'max-age=2' } }
    );

    expect(
        policy.satisfiesWithoutRevalidation({
            headers: { 'cache-control': 'fine' },
        })
    ).toBeTruthy();

    expect(
        policy.satisfiesWithoutRevalidation({
            headers: { 'cache-control': 'no-cache' },
        })
    ).toBeFalsy();

    expect(
        policy.satisfiesWithoutRevalidation({
            headers: { pragma: 'no-cache' },
        })
    ).toBeFalsy();
});
