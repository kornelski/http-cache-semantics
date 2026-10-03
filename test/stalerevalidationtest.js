'use strict';

const assert = require('assert');
const CachePolicy = require('..');

class TestCachePolicy extends CachePolicy {
    now() {
        return 1700000000000;
    }
}

const request = {
    url: '/document',
    method: 'GET',
    headers: { host: 'example.test', accept: 'text/plain' },
};
const errors = [500, 502, 503, 504].map((status) => ({ status, headers: {} }));
const extensions = 'max-age=60, stale-if-error=600, stale-while-revalidate=600';

function policies(headers, options, originalRequest = request) {
    const policy = new TestCachePolicy(
        originalRequest,
        {
            status: 200,
            headers: Object.assign(
                {
                    'cache-control': extensions,
                    age: '120',
                    etag: '"document-v1"',
                },
                headers
            ),
        },
        options
    );
    return [
        policy,
        TestCachePolicy.fromObject(
            JSON.parse(JSON.stringify(policy.toObject()))
        ),
    ];
}

function withHeaders(headers) {
    return Object.assign({}, request, {
        headers: Object.assign({}, request.headers, headers),
    });
}

function assertMiss(policy, next) {
    const result = policy.evaluateRequest(next);
    assert.strictEqual(result.response, undefined);
    assert.strictEqual(result.revalidation.synchronous, true);
    assert.strictEqual(policy.satisfiesWithoutRevalidation(next), false);
}

function assertNoErrorReuse(policy, next) {
    for (const response of errors) {
        const result = policy.revalidatedPolicy(next, response);
        assert.strictEqual(result.modified, true);
        assert.strictEqual(result.matches, false);
        assert.notStrictEqual(result.policy, policy);
    }
    for (const response of [undefined, null]) {
        assert.throws(
            () => policy.revalidatedPolicy(next, response),
            /Response headers missing/
        );
    }
}

describe('Stale reuse requires successful validation', function () {
    for (const vary of [
        ' * ',
        '\t*\t',
        '*,',
        ', *',
        'accept, *',
        '*, accept',
    ]) {
        it(`Vary ${JSON.stringify(
            vary
        )} blocks every stale reuse path`, function () {
            for (const policy of policies({ vary })) {
                assert.strictEqual(policy.maxAge(), 0);
                assert.strictEqual(policy.timeToLive(), 0);
                assert.strictEqual(policy.useStaleWhileRevalidate(), false);
                assertMiss(policy, request);
                assertMiss(
                    policy,
                    withHeaders({ 'cache-control': 'max-stale' })
                );
                assertMiss(
                    policy,
                    withHeaders({ 'cache-control': 'max-stale=86400' })
                );
                assertNoErrorReuse(policy, request);
                assert.strictEqual(
                    policy.revalidationHeaders(request)['if-none-match'],
                    undefined
                );
            }
        });
    }

    for (const headers of [
        { 'cache-control': 'no-cache' },
        { pragma: 'no-cache' },
        { pragma: 'extension, no-cache' },
    ]) {
        it(`request ${JSON.stringify(
            headers
        )} also blocks error fallback`, function () {
            for (const policy of policies({ vary: 'accept' })) {
                const next = withHeaders(headers);
                assertMiss(policy, next);
                assertNoErrorReuse(policy, next);
                // A successful conditional validation is still permitted.
                next.headers = policy.revalidationHeaders(next);
                assert.strictEqual(
                    next.headers['if-none-match'],
                    '"document-v1"'
                );
                const result = policy.revalidatedPolicy(next, {
                    status: 304,
                    headers: { etag: '"document-v1"', age: '0' },
                });
                assert.strictEqual(result.matches, true);
                assert.strictEqual(result.modified, false);
            }
        });
    }

    for (const directives of ['must-revalidate', 's-maxage=60']) {
        it(`${directives} permits fresh reuse and forbids stale reuse`, function () {
            for (const age of ['30', '120']) {
                for (const policy of policies({
                    'cache-control': `${extensions}, ${directives}`,
                    age,
                })) {
                    if (age === '30') {
                        assert.strictEqual(
                            policy.satisfiesWithoutRevalidation(request),
                            true
                        );
                        assert.strictEqual(policy.timeToLive(), 30000);
                    } else {
                        assertMiss(policy, request);
                        assertMiss(
                            policy,
                            withHeaders({ 'cache-control': 'max-stale' })
                        );
                        assertMiss(
                            policy,
                            withHeaders({ 'cache-control': 'max-stale=86400' })
                        );
                        assertNoErrorReuse(policy, request);
                        assert.strictEqual(policy.timeToLive(), 0);
                        assert.strictEqual(
                            policy.useStaleWhileRevalidate(),
                            false
                        );
                    }
                }
            }
        });
    }
});

describe('Stale extension retention', function () {
    const restrictions = [
        { 'cache-control': `${extensions}, no-store` },
        { 'cache-control': `${extensions}, no-cache` },
        { 'cache-control': `${extensions}, private` },
        { 'cache-control': `${extensions}, proxy-revalidate` },
        { 'set-cookie': 'sample=value' },
        { vary: '*' },
    ];
    for (const headers of restrictions) {
        it(`${JSON.stringify(
            headers
        )} cannot extend a zero lifetime`, function () {
            for (const policy of policies(headers)) {
                assert.strictEqual(policy.timeToLive(), 0);
                assertNoErrorReuse(policy, request);
            }
        });
    }

    it('ordinary extension retention does not mean a fresh cache hit', function () {
        for (const policy of policies({})) {
            assert.strictEqual(policy.timeToLive(), 540000);
            assert.strictEqual(
                policy.satisfiesWithoutRevalidation(request),
                false
            );
            const result = policy.evaluateRequest(request);
            assert.ok(result.response);
            assert.strictEqual(result.revalidation.synchronous, false);
        }
    });

    it('preserves cookie opt-ins and private cache extension retention', function () {
        for (const directive of ['public', 'immutable']) {
            for (const policy of policies({
                'cache-control': `${extensions}, ${directive}`,
                'set-cookie': 'sample=value',
            })) {
                assert.strictEqual(policy.timeToLive(), 540000);
                assert.strictEqual(
                    policy.revalidatedPolicy(request, null).modified,
                    false
                );
            }
        }
        for (const policy of policies(
            {
                'cache-control': `${extensions}, private, proxy-revalidate, s-maxage=60`,
                'set-cookie': 'sample=value',
            },
            { shared: false }
        )) {
            assert.strictEqual(policy.timeToLive(), 540000);
            assert.strictEqual(policy.useStaleWhileRevalidate(), true);
            assert.strictEqual(
                policy.revalidatedPolicy(request, undefined).modified,
                false
            );
        }
    });
});

describe('Request matching and compatibility controls', function () {
    const mismatches = [
        Object.assign({}, request, { url: '/another-document' }),
        Object.assign({}, request, { method: 'POST' }),
        withHeaders({ host: 'other.example.test' }),
        withHeaders({ accept: 'text/html' }),
    ];
    for (const next of mismatches) {
        it(`rejects ${JSON.stringify(next)} during stale reuse`, function () {
            for (const policy of policies({ vary: 'accept' })) {
                assertMiss(policy, next);
                assertNoErrorReuse(policy, next);
                assert.strictEqual(
                    policy.revalidationHeaders(next)['if-none-match'],
                    undefined
                );
            }
        });
    }

    it('Cache-Control takes precedence over the legacy request Pragma', function () {
        for (const policy of policies({})) {
            const next = withHeaders({
                'cache-control': 'max-stale',
                pragma: 'no-cache',
            });
            assert.strictEqual(policy.satisfiesWithoutRevalidation(next), true);
            assert.strictEqual(
                policy.revalidatedPolicy(next, null).modified,
                false
            );
        }
    });

    it('request no-store does not prohibit reuse of an already stored response', function () {
        for (const policy of policies({})) {
            const next = withHeaders({
                'cache-control': 'no-store, max-stale',
            });
            assert.strictEqual(policy.satisfiesWithoutRevalidation(next), true);
            assert.strictEqual(
                policy.revalidatedPolicy(next, null).modified,
                false
            );
        }
    });

    it('fresh no-cache requests cannot fall back after a failed validation', function () {
        for (const policy of policies({ age: '0' })) {
            assertNoErrorReuse(
                policy,
                withHeaders({ 'cache-control': 'no-cache' })
            );
        }
    });

    it('HEAD revalidation can reuse a matching GET representation', function () {
        for (const policy of policies({ vary: 'accept' })) {
            const next = Object.assign({}, request, { method: 'HEAD' });
            next.headers = policy.revalidationHeaders(next);
            assert.strictEqual(next.headers['if-none-match'], '"document-v1"');
            const result = policy.revalidatedPolicy(next, {
                status: 304,
                headers: { etag: '"document-v1"', age: '0' },
            });
            assert.strictEqual(result.matches, true);
            assert.strictEqual(result.modified, false);
        }
    });

    it('successful 304 validates restricted but storable entries', function () {
        for (const directive of [
            'no-cache',
            'must-revalidate',
            'proxy-revalidate',
        ]) {
            for (const policy of policies({
                'cache-control': `${extensions}, ${directive}`,
            })) {
                const next = Object.assign({}, request, {
                    headers: policy.revalidationHeaders(request),
                });
                const result = policy.revalidatedPolicy(next, {
                    status: 304,
                    headers: {
                        etag: '"document-v1"',
                        'cache-control': 'public, max-age=60',
                        age: '0',
                    },
                });
                assert.strictEqual(result.matches, true);
                assert.strictEqual(result.modified, false);
                assert.strictEqual(
                    result.policy.satisfiesWithoutRevalidation(request),
                    true
                );
            }
        }
    });

    it('an unrelated ETag does not validate the stored response', function () {
        for (const policy of policies({})) {
            const result = policy.revalidatedPolicy(request, {
                status: 304,
                headers: { etag: '"document-v2"' },
            });
            assert.strictEqual(result.matches, false);
        }
    });
});
