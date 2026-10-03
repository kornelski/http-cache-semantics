'use strict';

const assert = require('assert');
const CachePolicy = require('..');

class TestCachePolicy extends CachePolicy {
    now() {
        return 1700000000000;
    }
}

const request = {
    url: '/resource',
    method: 'GET',
    headers: { host: 'example.test', accept: 'text/plain' },
};

function policyFor(headers, options, originalRequest = request) {
    return new TestCachePolicy(
        originalRequest,
        {
            status: 200,
            headers: Object.assign(
                { 'cache-control': 'max-age=60', age: '120', etag: '"original"' },
                headers
            ),
        },
        options
    );
}

function originalAndRestored(policy) {
    return [
        policy,
        TestCachePolicy.fromObject(JSON.parse(JSON.stringify(policy.toObject()))),
    ];
}

const errorResponses = [500, 502, 503, 504].map(status => ({
    status,
    headers: {},
}));

describe('Restricted stale response reuse', function() {
    const restrictions = [
        ['shared Set-Cookie', { 'set-cookie': 'session=synthetic' }],
        ['proxy-revalidate', { 'cache-control': 'proxy-revalidate' }],
        ['no-cache', { 'cache-control': 'no-cache' }],
        ['no-store', { 'cache-control': 'no-store' }],
        ['private in a shared cache', { 'cache-control': 'private' }],
        ['must-revalidate', { 'cache-control': 'must-revalidate' }],
        ['Vary: *', { vary: '*' }],
    ];

    for (const [name, headers] of restrictions) {
        function policies() {
            return originalAndRestored(policyFor(Object.assign({}, headers, {
                'cache-control': [
                    'max-age=60',
                    headers['cache-control'],
                    'stale-if-error=600',
                    'stale-while-revalidate=600',
                ].filter(Boolean).join(', '),
            })));
        }

        it(`${name} cannot be reused through max-stale`, function() {
            for (const policy of policies()) {
                for (const directive of ['max-stale', 'max-stale=86400']) {
                    const next = Object.assign({}, request, {
                        headers: Object.assign({}, request.headers, {
                            'cache-control': directive,
                        }),
                    });
                    assert.strictEqual(policy.satisfiesWithoutRevalidation(next), false);
                    const result = policy.evaluateRequest(next);
                    assert.strictEqual(result.response, undefined);
                    assert.strictEqual(result.revalidation.synchronous, true);
                }
            }
        });

        it(`${name} cannot be reused through stale-if-error`, function() {
            for (const policy of policies()) {
                for (const response of errorResponses) {
                    const result = policy.revalidatedPolicy(request, response);
                    assert.strictEqual(result.matches, false);
                    assert.strictEqual(result.modified, true);
                    assert.notStrictEqual(result.policy, policy);
                }
                assert.throws(
                    () => policy.revalidatedPolicy(request, undefined),
                    /Response headers missing/
                );
            }
        });

        it(`${name} cannot be reused through stale-while-revalidate`, function() {
            for (const policy of policies()) {
                assert.strictEqual(policy.useStaleWhileRevalidate(), false);
                const result = policy.evaluateRequest(request);
                assert.strictEqual(result.response, undefined);
                assert.strictEqual(result.revalidation.synchronous, true);
            }
        });
    }
});

describe('Stale-if-error request matching', function() {
    const mismatches = [
        ['URL', Object.assign({}, request, { url: '/other' })],
        ['method', Object.assign({}, request, { method: 'POST' })],
        ['Host', Object.assign({}, request, {
            headers: Object.assign({}, request.headers, { host: 'other.test' }),
        })],
        ['Vary', Object.assign({}, request, {
            headers: Object.assign({}, request.headers, { accept: 'text/html' }),
        })],
    ];

    for (const [name, next] of mismatches) {
        it(`does not reuse a response when ${name} differs`, function() {
            for (const policy of originalAndRestored(policyFor({
                'cache-control': 'max-age=60, stale-if-error=600',
                vary: 'accept',
            }))) {
                for (const response of errorResponses) {
                    const result = policy.revalidatedPolicy(next, response);
                    assert.strictEqual(result.matches, false);
                    assert.strictEqual(result.modified, true);
                    assert.notStrictEqual(result.policy, policy);
                }
                assert.throws(
                    () => policy.revalidatedPolicy(next, undefined),
                    /Response headers missing/
                );
            }
        });
    }

    it('does not use a cached HEAD response for GET after an error', function() {
        const head = Object.assign({}, request, { method: 'HEAD' });
        const policy = policyFor({
            'cache-control': 'max-age=60, stale-if-error=600',
        }, undefined, head);
        const result = policy.revalidatedPolicy(request, errorResponses[0]);
        assert.strictEqual(result.matches, false);
        assert.strictEqual(result.modified, true);
    });

    it('preserves matching GET and HEAD error revalidation', function() {
        for (const policy of originalAndRestored(policyFor({
            'cache-control': 'max-age=60, stale-if-error=600',
            vary: 'accept',
        }))) {
            for (const method of ['GET', 'HEAD']) {
                const next = Object.assign({}, request, { method });
                for (const response of [undefined, ...errorResponses]) {
                    const result = policy.revalidatedPolicy(next, response);
                    assert.strictEqual(result.matches, true);
                    assert.strictEqual(result.modified, false);
                    assert.strictEqual(result.policy, policy);
                }
            }
        }
    });
});

describe('Permitted stale reuse and revalidation', function() {
    it('preserves ordinary max-stale reuse', function() {
        for (const policy of originalAndRestored(policyFor({}))) {
            assert.strictEqual(policy.satisfiesWithoutRevalidation(request), false);
            for (const directive of ['max-stale', 'max-stale=600']) {
                const next = Object.assign({}, request, {
                    headers: Object.assign({}, request.headers, {
                        'cache-control': directive,
                    }),
                });
                assert.strictEqual(policy.satisfiesWithoutRevalidation(next), true);
            }
        }
    });

    it('preserves ordinary stale-while-revalidate', function() {
        for (const policy of originalAndRestored(policyFor({
            'cache-control': 'max-age=60, stale-while-revalidate=600',
        }))) {
            assert.strictEqual(policy.useStaleWhileRevalidate(), true);
            const result = policy.evaluateRequest(request);
            assert.ok(result.response);
            assert.strictEqual(result.revalidation.synchronous, false);
            assert.strictEqual(policy.satisfiesWithoutRevalidation(request), false);
        }
    });

    it('does not reuse after the stale extension window expires', function() {
        const policy = policyFor({
            'cache-control': 'max-age=60, stale-if-error=600, stale-while-revalidate=600',
            age: '660',
        });
        assert.strictEqual(policy.useStaleWhileRevalidate(), false);
        const result = policy.revalidatedPolicy(request, errorResponses[0]);
        assert.strictEqual(result.matches, false);
        assert.strictEqual(result.modified, true);
    });

    it('preserves explicit shared-cookie opt-ins', function() {
        for (const directive of ['public', 'immutable']) {
            const policy = policyFor({
                'cache-control': `max-age=60, ${directive}, stale-if-error=600, stale-while-revalidate=600`,
                'set-cookie': 'session=synthetic',
            });
            assert.strictEqual(policy.useStaleWhileRevalidate(), true);
            assert.strictEqual(policy.revalidatedPolicy(request, errorResponses[0]).modified, false);
        }
    });

    it('preserves private-cache reuse of its own cookie response', function() {
        const policy = policyFor({
            'cache-control': 'max-age=60, private, proxy-revalidate, stale-if-error=600, stale-while-revalidate=600',
            'set-cookie': 'session=synthetic',
        }, { shared: false });
        assert.strictEqual(policy.useStaleWhileRevalidate(), true);
        assert.strictEqual(policy.revalidatedPolicy(request, errorResponses[0]).modified, false);
    });

    it('preserves successful conditional revalidation of no-cache responses', function() {
        const policy = policyFor({ 'cache-control': 'no-cache' });
        const next = Object.assign({}, request, {
            headers: policy.revalidationHeaders(request),
        });
        assert.strictEqual(next.headers['if-none-match'], '"original"');
        const result = policy.revalidatedPolicy(next, {
            status: 304,
            headers: { etag: '"original"', 'cache-control': 'max-age=60', age: '0' },
        });
        assert.strictEqual(result.matches, true);
        assert.strictEqual(result.modified, false);
        assert.strictEqual(result.policy.satisfiesWithoutRevalidation(request), true);
    });
});
