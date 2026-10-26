'use strict';

const assert = require('assert');
const CachePolicy = require('..');

const request = {
    method: 'GET',
    headers: { host: 'example.test' },
    url: '/',
};

function createPolicy(cacheControl, age, options) {
    const policy = new CachePolicy(
        request,
        {
            status: 200,
            headers: {
                age: String(age),
                'cache-control': cacheControl,
            },
        },
        options
    );
    policy.now = () => policy._responseTime;
    return policy;
}

describe('RFC 9111', function() {
    describe('storage', function() {
        it('does not store responses prohibited by no-store or an unsupported status', function() {
            const requestNoStore = new CachePolicy(
                { ...request, headers: { ...request.headers, 'cache-control': 'no-store' } },
                { status: 200, headers: { 'cache-control': 'max-age=60' } }
            );
            const responseNoStore = new CachePolicy(request, {
                status: 200,
                headers: { 'cache-control': 'max-age=60, no-store' },
            });
            const unsupportedStatus = new CachePolicy(request, {
                status: 299,
                headers: { 'cache-control': 'max-age=60' },
            });

            assert.strictEqual(requestNoStore.storable(), false);
            assert.strictEqual(responseNoStore.storable(), false);
            assert.strictEqual(unsupportedStatus.storable(), false);
        });
    });

    describe('response reuse', function() {
        it('reuses a matching fresh response and returns its current Age', function() {
            const policy = createPolicy('max-age=60', 30);
            const result = policy.evaluateRequest(request);

            assert(result.response);
            assert.strictEqual(result.revalidation, undefined);
            assert.strictEqual(result.response.headers.age, '30');
        });

        it('forces synchronous revalidation for a request with no-cache', function() {
            const policy = createPolicy('max-age=60', 30);
            const noCacheRequest = {
                ...request,
                headers: { ...request.headers, 'cache-control': 'no-cache' },
            };
            const result = policy.evaluateRequest(noCacheRequest);

            assert.strictEqual(result.response, undefined);
            assert(result.revalidation);
            assert.strictEqual(result.revalidation.synchronous, true);
        });

        it('does not serve stale when the response requires revalidation', function() {
            for (const directive of ['no-cache', 'must-revalidate']) {
                const policy = createPolicy(
                    `max-age=60, ${directive}`,
                    61
                );
                const staleRequest = {
                    ...request,
                    headers: { ...request.headers, 'cache-control': 'max-stale' },
                };
                const result = policy.evaluateRequest(staleRequest);

                assert.strictEqual(result.response, undefined, directive);
                assert.strictEqual(result.revalidation.synchronous, true, directive);
            }
        });

        it('honors a bounded max-stale request directive', function() {
            const withinLimit = createPolicy('max-age=60', 70).evaluateRequest({
                ...request,
                headers: { ...request.headers, 'cache-control': 'max-stale=10' },
            });
            const beyondLimit = createPolicy('max-age=60', 71).evaluateRequest({
                ...request,
                headers: { ...request.headers, 'cache-control': 'max-stale=10' },
            });

            assert(withinLimit.response);
            assert.strictEqual(withinLimit.revalidation, undefined);
            assert.strictEqual(beyondLimit.response, undefined);
            assert.strictEqual(beyondLimit.revalidation.synchronous, true);
        });
    });
});