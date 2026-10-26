'use strict';

const assert = require('assert');
const CachePolicy = require('..');

const request = {
    method: 'GET',
    headers: { host: 'example.test' },
    url: '/',
};

function createPolicy(cacheControl, age) {
    const policy = new CachePolicy(request, {
        status: 200,
        headers: {
            age: String(age),
            'cache-control': cacheControl,
        },
    });
    policy.now = () => policy._responseTime;
    return policy;
}

describe('RFC 5861', function() {
    describe('stale-if-error', function() {
        it('uses a stale response for the RFC-defined server error statuses within the window', function() {
            for (const status of [500, 502, 503, 504]) {
                const policy = createPolicy(
                    'max-age=60, stale-if-error=1200',
                    61
                );
                const result = policy.revalidatedPolicy(request, {
                    status,
                    headers: {},
                });

                assert.strictEqual(result.policy, policy);
                assert.strictEqual(result.modified, false);
                assert.strictEqual(result.matches, true);
            }
        });

        it('allows stale reuse at the stale-if-error limit', function() {
            const policy = createPolicy(
                'max-age=60, stale-if-error=1200',
                1260
            );
            const result = policy.revalidatedPolicy(request, {
                status: 503,
                headers: {},
            });

            assert.strictEqual(result.policy, policy);
            assert.strictEqual(result.modified, false);
            assert.strictEqual(result.matches, true);
        });

        it('does not use a stale response beyond the stale-if-error limit', function() {
            const policy = createPolicy(
                'max-age=60, stale-if-error=1200',
                1261
            );
            const result = policy.revalidatedPolicy(request, {
                status: 503,
                headers: {},
            });

            assert.notStrictEqual(result.policy, policy);
            assert.strictEqual(result.modified, true);
            assert.strictEqual(result.matches, false);
        });

        it('does not use stale-if-error for statuses outside the RFC error set', function() {
            for (const status of [200, 404, 429]) {
                const policy = createPolicy(
                    'max-age=60, stale-if-error=1200',
                    61
                );
                const result = policy.revalidatedPolicy(request, {
                    status,
                    headers: {},
                });

                assert.notStrictEqual(result.policy, policy);
                assert.strictEqual(result.modified, true);
                assert.strictEqual(result.matches, false);
            }
        });
    });

    describe('stale-while-revalidate', function() {
        it('serves stale immediately and requests asynchronous revalidation within the window', function() {
            const policy = createPolicy(
                'max-age=60, stale-while-revalidate=30',
                61
            );
            const result = policy.evaluateRequest(request);

            assert(result.response);
            assert(result.revalidation);
            assert.strictEqual(result.revalidation.synchronous, false);
        });

        it('does not serve stale after the stale-while-revalidate window', function() {
            const policy = createPolicy(
                'max-age=60, stale-while-revalidate=30',
                91
            );
            const result = policy.evaluateRequest(request);

            assert.strictEqual(result.response, undefined);
            assert(result.revalidation);
            assert.strictEqual(result.revalidation.synchronous, true);
        });
    });
});