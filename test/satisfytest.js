'use strict';

const assert = require('assert');
const CachePolicy = require('..');

describe('Satisfies', function() {
    it('when URLs match', function() {
        const policy = new CachePolicy(
            { url: '/', headers: {} },
            { status: 200, headers: { 'cache-control': 'max-age=2' } }
        );
        assert(policy.satisfiesWithoutRevalidation({ url: '/', headers: {} }));
    });

    it('when expires is present', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                status: 302,
                headers: { expires: new Date(Date.now() + 2000).toGMTString() },
            }
        );
        assert(policy.satisfiesWithoutRevalidation({ headers: {} }));
    });

    it('not when URLs mismatch', function() {
        const policy = new CachePolicy(
            { url: '/foo', headers: {} },
            { status: 200, headers: { 'cache-control': 'max-age=2' } }
        );
        assert(
            !policy.satisfiesWithoutRevalidation({
                url: '/foo?bar',
                headers: {},
            })
        );
    });

    it('when methods match', function() {
        const policy = new CachePolicy(
            { method: 'GET', headers: {} },
            { status: 200, headers: { 'cache-control': 'max-age=2' } }
        );
        assert(
            policy.satisfiesWithoutRevalidation({ method: 'GET', headers: {} })
        );
    });

    it('not when hosts mismatch', function() {
        const policy = new CachePolicy(
            { headers: { host: 'foo' } },
            { status: 200, headers: { 'cache-control': 'max-age=2' } }
        );
        assert(
            policy.satisfiesWithoutRevalidation({ headers: { host: 'foo' } })
        );
        assert(
            !policy.satisfiesWithoutRevalidation({
                headers: { host: 'foofoo' },
            })
        );
    });

    it('when methods match HEAD', function() {
        const policy = new CachePolicy(
            { method: 'HEAD', headers: {} },
            { status: 200, headers: { 'cache-control': 'max-age=2' } }
        );
        assert(
            policy.satisfiesWithoutRevalidation({ method: 'HEAD', headers: {} })
        );
    });

    it('not when methods mismatch', function() {
        const policy = new CachePolicy(
            { method: 'POST', headers: {} },
            { status: 200, headers: { 'cache-control': 'max-age=2' } }
        );
        assert(
            !policy.satisfiesWithoutRevalidation({ method: 'GET', headers: {} })
        );
    });

    it('not when methods mismatch HEAD', function() {
        const policy = new CachePolicy(
            { method: 'HEAD', headers: {} },
            { status: 200, headers: { 'cache-control': 'max-age=2' } }
        );
        assert(
            !policy.satisfiesWithoutRevalidation({ method: 'GET', headers: {} })
        );
    });

    it('not when proxy revalidating', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                status: 200,
                headers: { 'cache-control': 'max-age=2, proxy-revalidate ' },
            }
        );
        assert(!policy.satisfiesWithoutRevalidation({ headers: {} }));
    });

    it('when not a proxy revalidating', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                status: 200,
                headers: { 'cache-control': 'max-age=2, proxy-revalidate ' },
            },
            { shared: false }
        );
        assert(policy.satisfiesWithoutRevalidation({ headers: {} }));
    });

    it('max-stale cannot bypass response revalidation safeguards', function() {
        const protectedResponses = [
            {
                name: 'Set-Cookie on a shared cache',
                headers: {
                    age: '10',
                    'cache-control': 'max-age=1',
                    'set-cookie': 'session=secret',
                },
            },
            {
                name: 'proxy-revalidate on a shared cache',
                headers: {
                    age: '10',
                    'cache-control': 'max-age=1, proxy-revalidate',
                },
            },
            {
                name: 'no-cache response',
                headers: {
                    age: '10',
                    'cache-control': 'max-age=1, no-cache',
                },
            },
            {
                name: 'must-revalidate response',
                headers: {
                    age: '10',
                    'cache-control': 'max-age=1, must-revalidate',
                },
            },
        ];

        for (const response of protectedResponses) {
            const policy = new CachePolicy(
                { headers: {} },
                { status: 200, headers: response.headers }
            );

            assert(policy.stale(), `${response.name} should be stale`);
            for (const maxStale of ['max-stale', 'max-stale=1000']) {
                const result = policy.evaluateRequest({
                    headers: { 'cache-control': maxStale },
                });
                assert.strictEqual(
                    result.response,
                    undefined,
                    `${response.name} must not be reused with ${maxStale}`
                );
                assert(result.revalidation, `${response.name} must require revalidation`);
            }
        }
    });

    it('max-stale still allows an ordinary expired response within its limit', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                status: 200,
                headers: {
                    age: '10',
                    'cache-control': 'public, max-age=1',
                },
            }
        );

        assert(policy.stale());
        assert(
            policy.satisfiesWithoutRevalidation({
                headers: { 'cache-control': 'max-stale=20' },
            })
        );
    });

    it('not when no-cache requesting', function() {
        const policy = new CachePolicy(
            { headers: {} },
            { headers: { 'cache-control': 'max-age=2' } }
        );
        assert(
            policy.satisfiesWithoutRevalidation({
                headers: { 'cache-control': 'fine' },
            })
        );
        assert(
            !policy.satisfiesWithoutRevalidation({
                headers: { 'cache-control': 'no-cache' },
            })
        );
        assert(
            !policy.satisfiesWithoutRevalidation({
                headers: { pragma: 'no-cache' },
            })
        );
    });
});
