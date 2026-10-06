'use strict';

const assert = require('assert');
const CachePolicy = require('..');

describe('Satisfies', function() {
    describe('reuse safeguards', function() {
        const restrictions = [
            'no-cache',
            'no-store',
            'private',
            'must-revalidate',
            'proxy-revalidate',
            's-maxage=1',
            's-maxage=0',
            'No-Cache',
            'No-Store',
            'Private',
            'Must-Revalidate',
            'Proxy-Revalidate',
            'S-MaxAge=1',
        ];

        for (const restriction of restrictions) {
            it(`blocks stale reuse with ${restriction}`, function() {
                const original = new CachePolicy(
                    { headers: {} },
                    { headers: {
                        age: '10',
                        'cache-control': `max-age=1, ${restriction}, stale-while-revalidate=100, stale-if-error=100`,
                    } }
                );
                for (const policy of [original, CachePolicy.fromObject(original.toObject())]) {
                    policy.now = () => policy._responseTime;
                    for (const cacheControl of ['', 'max-stale', 'max-stale=1000']) {
                        const result = policy.evaluateRequest({
                            headers: { 'cache-control': cacheControl },
                        });
                        assert.strictEqual(result.response, undefined);
                        assert.strictEqual(result.revalidation.synchronous, true);
                    }
                    assert.strictEqual(policy.useStaleWhileRevalidate(), false);
                    for (const status of [500, 502, 503, 504]) {
                        const result = policy.revalidatedPolicy(
                            { headers: {} },
                            { status, headers: {} }
                        );
                        assert.strictEqual(result.modified, true);
                        assert.notStrictEqual(result.policy, policy);
                    }
                    assert.throws(() => policy.revalidatedPolicy({ headers: {} }, undefined), /Response headers missing/);
                }
            });
        }

        for (const directive of ['must-revalidate', 'proxy-revalidate', 's-maxage=60']) {
            it(`allows fresh reuse with ${directive}`, function() {
                const policy = new CachePolicy(
                    { headers: {} },
                    { headers: { age: '10', 'cache-control': `max-age=60, ${directive}` } }
                );
                policy.now = () => policy._responseTime;
                assert.strictEqual(policy.stale(), false);
                assert(policy.satisfiesWithoutRevalidation({ headers: {} }));
            });
        }

        for (const directive of ['private', 'proxy-revalidate', 's-maxage=0']) {
            it(`allows private-cache stale reuse with ${directive}`, function() {
                const policy = new CachePolicy(
                    { headers: {} },
                    { headers: {
                        age: '10',
                        'cache-control': `max-age=1, ${directive}, stale-while-revalidate=100, stale-if-error=100`,
                    } },
                    { shared: false }
                );
                policy.now = () => policy._responseTime;
                assert(policy.satisfiesWithoutRevalidation({ headers: { 'cache-control': 'max-stale' } }));
                assert(policy.useStaleWhileRevalidate());
                assert.strictEqual(policy.revalidatedPolicy({ headers: {} }, { status: 503, headers: {} }).policy, policy);
            });
        }

        for (const options of [
            { shared: true, directive: '', allowed: false },
            { shared: true, directive: ', public', allowed: true },
            { shared: true, directive: ', immutable', allowed: true },
            { shared: false, directive: '', allowed: true },
        ]) {
            it(`preserves cookie safeguards with ${JSON.stringify(options)}`, function() {
                const original = new CachePolicy(
                    { headers: {} },
                    { headers: {
                        age: '10',
                        'set-cookie': 'session=example',
                        'cache-control': `max-age=1, stale-while-revalidate=100, stale-if-error=100${options.directive}`,
                    } },
                    { shared: options.shared }
                );
                for (const policy of [original, CachePolicy.fromObject(original.toObject())]) {
                    policy.now = () => policy._responseTime;
                    for (const cacheControl of ['max-stale', 'max-stale=1000']) {
                        assert.strictEqual(policy.satisfiesWithoutRevalidation({
                            headers: { 'cache-control': cacheControl },
                        }), options.allowed);
                    }
                    const result = policy.evaluateRequest({ headers: {} });
                    assert.strictEqual(Boolean(result.response), options.allowed);
                    assert.strictEqual(result.revalidation.synchronous, !options.allowed);
                    assert.strictEqual(policy.useStaleWhileRevalidate(), options.allowed);
                    assert.strictEqual(policy.revalidatedPolicy(
                        { headers: {} }, { status: 503, headers: {} }
                    ).policy === policy, options.allowed);
                }
            });
        }

        it('does not reuse responses to no-store or unauthorized shared requests', function() {
            for (const headers of [
                { 'cache-control': 'no-store' },
                { authorization: 'Bearer example' },
            ]) {
                const policy = new CachePolicy(
                    { headers },
                    { headers: { age: '10', 'cache-control': 'max-age=1, stale-while-revalidate=100, stale-if-error=100' } }
                );
                policy.now = () => policy._responseTime;
                assert.strictEqual(policy.storable(), false);
                assert.strictEqual(policy.evaluateRequest({ headers: { 'cache-control': 'max-stale' } }).response, undefined);
                assert.strictEqual(policy.useStaleWhileRevalidate(), false);
                assert.strictEqual(policy.revalidatedPolicy({ headers: {} }, { status: 503, headers: {} }).modified, true);
            }
        });

        it('accepts max-stale at its exact limit, but not beyond it', function() {
            const policy = new CachePolicy(
                { headers: {} },
                { headers: { age: '10', 'cache-control': 'max-age=1' } }
            );
            policy.now = () => policy._responseTime;
            assert(policy.satisfiesWithoutRevalidation({ headers: { 'cache-control': 'Max-Stale=9' } }));
            assert(!policy.satisfiesWithoutRevalidation({ headers: { 'cache-control': 'max-stale=8' } }));
        });
    });

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

    it('when fresh and proxy revalidating', function() {
        const policy = new CachePolicy(
            { headers: {} },
            {
                status: 200,
                headers: { 'cache-control': 'max-age=2, proxy-revalidate ' },
            }
        );
        assert(policy.satisfiesWithoutRevalidation({ headers: {} }));
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
