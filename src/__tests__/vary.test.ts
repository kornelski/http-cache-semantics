import CachePolicy = require('..');

test('Basic', () => {
    const policy = new CachePolicy(
        { headers: { weather: 'nice' } },
        { headers: { 'cache-control': 'max-age=5', vary: 'weather' } }
    );

    expect(
        policy.satisfiesWithoutRevalidation({
            headers: { weather: 'nice' },
        })
    ).toBeTruthy();
    expect(
        !policy.satisfiesWithoutRevalidation({
            headers: { weather: 'bad' },
        })
    ).toBeTruthy();
});

test("* doesn't match", () => {
    const policy = new CachePolicy(
        { headers: { weather: 'ok' } },
        { headers: { 'cache-control': 'max-age=5', vary: '*' } }
    );

    expect(
        policy.satisfiesWithoutRevalidation({ headers: { weather: 'ok' } })
    ).toBeFalsy();
});

test('* is stale', () => {
    const policy = new CachePolicy(
        { headers: { weather: 'ok' } },
        { headers: { 'cache-control': 'public,max-age=99', vary: '*' } }
    );

    expect(policy.stale()).toBeTruthy();
});

test('other varies are not', () => {
    const policy = new CachePolicy(
        { headers: { weather: 'ok' } },
        {
            headers: {
                'cache-control': 'public,max-age=99',
                vary: 'weather',
            },
        }
    );

    expect(policy.stale()).toBeFalsy();
});

test('Values are case-sensitive', () => {
    const policy = new CachePolicy(
        { headers: { weather: 'BAD' } },
        { headers: { 'cache-control': 'max-age=5', vary: 'Weather' } }
    );

    expect(
        policy.satisfiesWithoutRevalidation({ headers: { weather: 'BAD' } })
    ).toBeTruthy();

    expect(
        policy.satisfiesWithoutRevalidation({
            headers: { weather: 'bad' },
        })
    ).toBeFalsy();
});

test('Irrelevant headers ignored', () => {
    const policy = new CachePolicy(
        { headers: { weather: 'nice' } },
        { headers: { 'cache-control': 'max-age=5', vary: 'moon-phase' } }
    );

    expect(
        policy.satisfiesWithoutRevalidation({ headers: { weather: 'bad' } })
    ).toBeTruthy();

    expect(
        policy.satisfiesWithoutRevalidation({ headers: { sun: 'shining' } })
    ).toBeTruthy();

    expect(
        policy.satisfiesWithoutRevalidation({
            headers: { 'moon-phase': 'full' },
        })
    ).toBeFalsy();
});

test('Absence is meaningful', () => {
    const policy = new CachePolicy(
        { headers: { weather: 'nice' } },
        {
            headers: {
                'cache-control': 'max-age=5',
                vary: 'moon-phase, weather',
            },
        }
    );

    expect(
        policy.satisfiesWithoutRevalidation({
            headers: { weather: 'nice' },
        })
    ).toBeTruthy();

    expect(
        policy.satisfiesWithoutRevalidation({
            headers: { weather: 'nice', 'moon-phase': '' },
        })
    ).toBeFalsy();

    expect(policy.satisfiesWithoutRevalidation({ headers: {} })).toBeFalsy();
});

test('All values must match', () => {
    const policy = new CachePolicy(
        { headers: { sun: 'shining', weather: 'nice' } },
        { headers: { 'cache-control': 'max-age=5', vary: 'weather, sun' } }
    );

    expect(
        policy.satisfiesWithoutRevalidation({
            headers: { sun: 'shining', weather: 'nice' },
        })
    ).toBeTruthy();

    expect(
        policy.satisfiesWithoutRevalidation({
            headers: { sun: 'shining', weather: 'bad' },
        })
    ).toBeFalsy();
});

test('Whitespace is OK', () => {
    const policy = new CachePolicy(
        { headers: { sun: 'shining', weather: 'nice' } },
        {
            headers: {
                'cache-control': 'max-age=5',
                vary: '    weather       ,     sun     ',
            },
        }
    );

    expect(
        policy.satisfiesWithoutRevalidation({
            headers: { sun: 'shining', weather: 'nice' },
        })
    ).toBeTruthy();

    expect(
        policy.satisfiesWithoutRevalidation({
            headers: { weather: 'nice' },
        })
    ).toBeFalsy();

    expect(
        policy.satisfiesWithoutRevalidation({
            headers: { sun: 'shining' },
        })
    ).toBeFalsy();
});

test('Order is irrelevant', () => {
    const policy1 = new CachePolicy(
        { headers: { sun: 'shining', weather: 'nice' } },
        { headers: { 'cache-control': 'max-age=5', vary: 'weather, sun' } }
    );

    const policy2 = new CachePolicy(
        { headers: { sun: 'shining', weather: 'nice' } },
        { headers: { 'cache-control': 'max-age=5', vary: 'sun, weather' } }
    );

    expect(
        policy1.satisfiesWithoutRevalidation({
            headers: { weather: 'nice', sun: 'shining' },
        })
    ).toBeTruthy();

    expect(
        policy1.satisfiesWithoutRevalidation({
            headers: { sun: 'shining', weather: 'nice' },
        })
    ).toBeTruthy();

    expect(
        policy2.satisfiesWithoutRevalidation({
            headers: { weather: 'nice', sun: 'shining' },
        })
    ).toBeTruthy();

    expect(
        policy2.satisfiesWithoutRevalidation({
            headers: { sun: 'shining', weather: 'nice' },
        })
    ).toBeTruthy();
});
