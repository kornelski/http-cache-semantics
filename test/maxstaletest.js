'use strict';

const assert = require('assert');
const CachePolicy = require('..');

describe('max-stale response restrictions', function() {
    it('requires validation for a no-cache response with bounded max-stale', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: '10',
                    'cache-control': 'max-age=1, no-cache',
                    etag: '"version-1"',
                },
            }
        );
        const request = { headers: { 'cache-control': 'max-stale=1000' } };

        const result = policy.evaluateRequest(request);
        const satisfies = policy.satisfiesWithoutRevalidation(request);

        assert.strictEqual(satisfies, false);
        assert.deepStrictEqual(result, {
            response: undefined,
            revalidation: {
                synchronous: true,
                headers: {
                    'cache-control': 'max-stale=1000',
                    'if-none-match': '"version-1"',
                },
            },
        });
    });

    it('requires validation for no-cache in a private cache with unbounded max-stale', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: '10',
                    'cache-control': 'max-age=1, no-cache',
                },
            },
            { shared: false }
        );
        const request = { headers: { 'cache-control': 'max-stale' } };

        const result = policy.evaluateRequest(request);
        const satisfies = policy.satisfiesWithoutRevalidation(request);

        assert.strictEqual(satisfies, false);
        assert.strictEqual(result.response, undefined);
        assert.strictEqual(result.revalidation.synchronous, true);
    });

    it('requires validation for shared proxy-revalidate with bounded max-stale', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: '10',
                    'cache-control': 'max-age=1, proxy-revalidate',
                },
            }
        );
        const request = { headers: { 'cache-control': 'max-stale=1000' } };

        const result = policy.evaluateRequest(request);
        const satisfies = policy.satisfiesWithoutRevalidation(request);

        assert.strictEqual(satisfies, false);
        assert.strictEqual(result.response, undefined);
        assert.strictEqual(result.revalidation.synchronous, true);
    });

    it('preserves the shared cookie policy with unbounded max-stale', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: '10',
                    'cache-control': 'max-age=1',
                    'set-cookie': 'session=example',
                },
            }
        );
        const request = { headers: { 'cache-control': 'max-stale' } };

        const result = policy.evaluateRequest(request);
        const satisfies = policy.satisfiesWithoutRevalidation(request);

        assert.strictEqual(satisfies, false);
        assert.strictEqual(result.response, undefined);
        assert.strictEqual(result.revalidation.synchronous, true);
    });

    it('does not fall back to stale-while-revalidate for no-cache', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: '10',
                    'cache-control': 'no-cache, stale-while-revalidate=60',
                },
            }
        );
        const request = { headers: { 'cache-control': 'max-stale=1000' } };

        const result = policy.evaluateRequest(request);
        const satisfies = policy.satisfiesWithoutRevalidation(request);

        assert.strictEqual(satisfies, false);
        assert.strictEqual(result.response, undefined);
        assert.strictEqual(result.revalidation.synchronous, true);
    });

    it('does not fall back to stale-while-revalidate for shared proxy-revalidate', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: '10',
                    'cache-control': 'proxy-revalidate, stale-while-revalidate=60',
                },
            }
        );
        const request = { headers: { 'cache-control': 'max-stale' } };

        const result = policy.evaluateRequest(request);
        const satisfies = policy.satisfiesWithoutRevalidation(request);

        assert.strictEqual(satisfies, false);
        assert.strictEqual(result.response, undefined);
        assert.strictEqual(result.revalidation.synchronous, true);
    });

    it('does not fall back to stale-while-revalidate for shared cookies', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: '10',
                    'cache-control': 'stale-while-revalidate=60',
                    'set-cookie': 'session=example',
                },
            }
        );
        const request = { headers: { 'cache-control': 'max-stale=1000' } };

        const result = policy.evaluateRequest(request);
        const satisfies = policy.satisfiesWithoutRevalidation(request);

        assert.strictEqual(satisfies, false);
        assert.strictEqual(result.response, undefined);
        assert.strictEqual(result.revalidation.synchronous, true);
    });

    it('allows an ordinary expired response within the max-stale limit', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: '10',
                    'cache-control': 'public, max-age=1',
                },
            }
        );
        const request = { headers: { 'cache-control': 'max-stale=20' } };

        const result = policy.evaluateRequest(request);
        const satisfies = policy.satisfiesWithoutRevalidation(request);

        assert.strictEqual(satisfies, true);
        assert.strictEqual(result.revalidation, undefined);
    });

    it('still rejects an ordinary response beyond the max-stale limit', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: '10',
                    'cache-control': 'public, max-age=1',
                },
            }
        );
        const request = { headers: { 'cache-control': 'max-stale=5' } };

        const result = policy.evaluateRequest(request);
        const satisfies = policy.satisfiesWithoutRevalidation(request);

        assert.strictEqual(satisfies, false);
        assert.strictEqual(result.response, undefined);
        assert.strictEqual(result.revalidation.synchronous, true);
    });

    it('allows max-stale when an ordinary response has a zero freshness lifetime', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: '10',
                    'cache-control': 'max-age=0',
                },
            }
        );
        const request = { headers: { 'cache-control': 'max-stale=20' } };

        const result = policy.evaluateRequest(request);
        const satisfies = policy.satisfiesWithoutRevalidation(request);

        assert.strictEqual(satisfies, true);
        assert.strictEqual(result.revalidation, undefined);
    });

    it('preserves explicit public caching of shared cookie responses', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: '10',
                    'cache-control': 'public, max-age=1',
                    'set-cookie': 'session=example',
                },
            }
        );
        const request = { headers: { 'cache-control': 'max-stale=20' } };

        const result = policy.evaluateRequest(request);
        const satisfies = policy.satisfiesWithoutRevalidation(request);

        assert.strictEqual(satisfies, true);
        assert.strictEqual(result.revalidation, undefined);
        assert.strictEqual(result.response.headers['set-cookie'], 'session=example');
    });

    it('preserves the immutable exception for shared cookie responses', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: '10',
                    'cache-control': 'immutable, max-age=1',
                    'set-cookie': 'session=example',
                },
            }
        );
        const request = { headers: { 'cache-control': 'max-stale=20' } };

        const result = policy.evaluateRequest(request);
        const satisfies = policy.satisfiesWithoutRevalidation(request);

        assert.strictEqual(satisfies, true);
        assert.strictEqual(result.revalidation, undefined);
        assert.strictEqual(result.response.headers['set-cookie'], 'session=example');
    });

    it('allows max-stale for cookies in a private cache', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: '10',
                    'cache-control': 'max-age=1',
                    'set-cookie': 'session=example',
                },
            },
            { shared: false }
        );
        const request = { headers: { 'cache-control': 'max-stale' } };

        const result = policy.evaluateRequest(request);
        const satisfies = policy.satisfiesWithoutRevalidation(request);

        assert.strictEqual(satisfies, true);
        assert.strictEqual(result.revalidation, undefined);
        assert.strictEqual(result.response.headers['set-cookie'], 'session=example');
    });

    it('ignores proxy-revalidate in a private cache when serving stale responses', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: '10',
                    'cache-control': 'max-age=1, proxy-revalidate',
                },
            },
            { shared: false }
        );
        const request = { headers: { 'cache-control': 'max-stale=20' } };

        const result = policy.evaluateRequest(request);
        const satisfies = policy.satisfiesWithoutRevalidation(request);

        assert.strictEqual(satisfies, true);
        assert.strictEqual(result.revalidation, undefined);
    });
});
