'use strict';

const assert = require('assert');
const CachePolicy = require('..');

const request = {
    method: 'GET',
    headers: {},
    url: '/',
};

describe('RFC 9110 method semantics used by the cache', function() {
    it('treats method names as case-sensitive when matching requests', function() {
        const policy = new CachePolicy(request, {
            status: 200,
            headers: { 'cache-control': 'max-age=60' },
        });

        assert.strictEqual(
            policy.satisfiesWithoutRevalidation({
                ...request,
                method: 'get',
            }),
            false
        );
    });

    it('allows HEAD to revalidate a response stored from GET', function() {
        const policy = new CachePolicy(request, {
            status: 200,
            headers: {
                'cache-control': 'max-age=60',
                etag: '"version-1"',
            },
        });
        const headers = policy.revalidationHeaders({
            ...request,
            method: 'HEAD',
        });

        assert.strictEqual(headers['if-none-match'], '"version-1"');
    });

    it('does not use a response stored from HEAD to satisfy GET', function() {
        const policy = new CachePolicy(
            { ...request, method: 'HEAD' },
            {
                status: 200,
                headers: { 'cache-control': 'max-age=60' },
            }
        );

        assert.strictEqual(policy.satisfiesWithoutRevalidation(request), false);
    });
});