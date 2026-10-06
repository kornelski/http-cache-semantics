'use strict';

const assert = require('assert');
const CachePolicy = require('..');

const simpleRequest = {
    method: 'GET',
    headers: {
        host: 'www.w3c.org',
        connection: 'close',
    },
    url: '/Protocols/rfc2616/rfc2616-sec14.html',
};
function withHeaders(request, headers) {
    return Object.assign({}, request, {
        headers: Object.assign({}, request.headers, headers),
    });
}

const cacheableResponse = { headers: { 'cache-control': 'max-age=111' } };
const etaggedResponse = {
    headers: Object.assign({ etag: '"123456789"' }, cacheableResponse.headers),
};
const weakTaggedResponse = {
    headers: Object.assign(
        { etag: 'W/"123456789"' },
        cacheableResponse.headers
    ),
};
const lastModifiedResponse = {
    headers: Object.assign(
        { 'last-modified': 'Tue, 15 Nov 1994 12:45:26 GMT' },
        cacheableResponse.headers
    ),
};
const multiValidatorResponse = {
    headers: Object.assign(
        {},
        etaggedResponse.headers,
        lastModifiedResponse.headers
    ),
};

function notModifiedResponseHeaders(
    firstRequest,
    firstResponse,
    secondRequest,
    secondResponse
) {
    const cache = new CachePolicy(firstRequest, firstResponse);
    const headers = cache.revalidationHeaders(secondRequest);
    const { policy: newCache, modified } = cache.revalidatedPolicy(
        { headers },
        secondResponse
    );
    if (modified) {
        return false;
    }
    return newCache.responseHeaders();
}

function assertUpdates(
    firstRequest,
    firstResponse,
    secondRequest,
    secondResponse
) {
    firstResponse = withHeaders(firstResponse, { foo: 'original', 'x-other': 'original' });
    if (!firstResponse.status) {
        firstResponse.status = 200;
    }
    secondResponse = withHeaders(secondResponse, {
        foo: 'updated',
        'x-ignore-new': 'ignoreme',
    });
    if (!secondResponse.status) {
        secondResponse.status = 304;
    }

    const headers = notModifiedResponseHeaders(
        firstRequest,
        firstResponse,
        secondRequest,
        secondResponse
    );
    assert(headers);
    assert.equal(headers['foo'], 'updated');
    assert.equal(headers['x-other'], 'original');
    assert.strictEqual(headers['x-ignore-new'], undefined);
    assert.strictEqual(headers['etag'], secondResponse.headers.etag);
}

describe('Update revalidated', function() {
    it('Matching etags are updated', function() {
        assertUpdates(
            simpleRequest,
            etaggedResponse,
            simpleRequest,
            etaggedResponse
        );
    });

    it('Matching weak etags are updated', function() {
        assertUpdates(
            simpleRequest,
            weakTaggedResponse,
            simpleRequest,
            weakTaggedResponse
        );
    });

    it('Matching lastmod are updated', function() {
        assertUpdates(
            simpleRequest,
            lastModifiedResponse,
            simpleRequest,
            lastModifiedResponse
        );
    });

    it('Both matching are updated', function() {
        assertUpdates(
            simpleRequest,
            multiValidatorResponse,
            simpleRequest,
            multiValidatorResponse
        );
    });

    it('Checks status', function() {
        const response304 = Object.assign({}, multiValidatorResponse, {
            status: 304,
        });
        const response200 = Object.assign({}, multiValidatorResponse, {
            status: 200,
        });
        assertUpdates(
            simpleRequest,
            multiValidatorResponse,
            simpleRequest,
            response304
        );
        assert(
            !notModifiedResponseHeaders(
                simpleRequest,
                multiValidatorResponse,
                simpleRequest,
                response200
            )
        );
    });

    it('Last-mod ignored if etag is wrong', function() {
        assert(
            !notModifiedResponseHeaders(
                simpleRequest,
                multiValidatorResponse,
                simpleRequest,
                withHeaders(multiValidatorResponse, { etag: 'bad' })
            )
        );
        assert(
            !notModifiedResponseHeaders(
                simpleRequest,
                multiValidatorResponse,
                simpleRequest,
                withHeaders(multiValidatorResponse, { etag: 'W/bad' })
            )
        );
    });

    it('Ignored if validator is missing', function() {
        assert(
            !notModifiedResponseHeaders(
                simpleRequest,
                etaggedResponse,
                simpleRequest,
                cacheableResponse
            )
        );
        assert(
            !notModifiedResponseHeaders(
                simpleRequest,
                weakTaggedResponse,
                simpleRequest,
                cacheableResponse
            )
        );
        assert(
            !notModifiedResponseHeaders(
                simpleRequest,
                lastModifiedResponse,
                simpleRequest,
                cacheableResponse
            )
        );
    });

    it('Skips update of content-length', function() {
        const etaggedResponseWithLenght1 = withHeaders(etaggedResponse, {
            'content-length': 1,
        });
        const etaggedResponseWithLenght2 = withHeaders(etaggedResponse, {
            'content-length': 2,
        });
        const headers = notModifiedResponseHeaders(
            simpleRequest,
            etaggedResponseWithLenght1,
            simpleRequest,
            etaggedResponseWithLenght2
        );
        assert.equal(1, headers['content-length']);
    });

    it('Ignored if validator is different', function() {
        assert(
            !notModifiedResponseHeaders(
                simpleRequest,
                lastModifiedResponse,
                simpleRequest,
                etaggedResponse
            )
        );
        assert(
            !notModifiedResponseHeaders(
                simpleRequest,
                lastModifiedResponse,
                simpleRequest,
                weakTaggedResponse
            )
        );
        assert(
            !notModifiedResponseHeaders(
                simpleRequest,
                etaggedResponse,
                simpleRequest,
                lastModifiedResponse
            )
        );
    });

    it("Ignored if validator doesn't match", function() {
        assert(
            !notModifiedResponseHeaders(
                simpleRequest,
                etaggedResponse,
                simpleRequest,
                withHeaders(etaggedResponse, { etag: '"other"' })
            ),
            'bad etag'
        );
        assert(
            !notModifiedResponseHeaders(
                simpleRequest,
                lastModifiedResponse,
                simpleRequest,
                withHeaders(lastModifiedResponse, { 'last-modified': 'dunno' })
            ),
            'bad lastmod'
        );
    });

    it("staleIfError revalidate, no response", function() {
        const cacheableStaleResponse = { headers: { 'cache-control': 'max-age=200, stale-if-error=300' } };
        const cache = new CachePolicy(simpleRequest, cacheableStaleResponse);

        const { policy, modified } = cache.revalidatedPolicy(
            simpleRequest,
            null
        );
        assert(policy === cache);
        assert(modified === false);
    });

    it("staleIfError revalidate, server error", function() {
        const cacheableStaleResponse = { headers: { 'cache-control': 'max-age=200, stale-if-error=300' } };
        const cache = new CachePolicy(simpleRequest, cacheableStaleResponse);

        const { policy, modified } = cache.revalidatedPolicy(
            simpleRequest,
            { status: 500, headers: {} }
        );
        assert(policy === cache);
        assert(modified === false);
    });

    describe('stale-if-error request matching', function() {
        const request = withHeaders(simpleRequest, { 'accept-language': 'en' });
        const response = {
            status: 200,
            headers: {
                age: '10',
                'cache-control': 'max-age=1, stale-if-error=100',
                vary: 'accept-language',
                etag: '"matching"',
            },
        };
        const variants = [
            { name: 'matching GET', request, allowed: true },
            { name: 'matching HEAD', request: Object.assign({}, request, { method: 'HEAD' }), allowed: true },
            { name: 'different URL', request: Object.assign({}, request, { url: '/other' }), allowed: false },
            { name: 'missing URL', request: { method: 'GET', headers: request.headers }, allowed: false },
            { name: 'different method', request: Object.assign({}, request, { method: 'POST' }), allowed: false },
            { name: 'different host', request: withHeaders(request, { host: 'other.example' }), allowed: false },
            { name: 'different Vary', request: withHeaders(request, { 'accept-language': 'fr' }), allowed: false },
        ];
        for (const variant of variants) {
            it(variant.name, function() {
                const original = new CachePolicy(request, response);
                for (const cache of [original, CachePolicy.fromObject(original.toObject())]) {
                    cache.now = () => cache._responseTime;
                    for (const status of [500, 502, 503, 504]) {
                        const result = cache.revalidatedPolicy(variant.request, { status, headers: {} });
                        assert.strictEqual(result.policy === cache, variant.allowed);
                        assert.strictEqual(result.modified, !variant.allowed);
                        assert.strictEqual(result.matches, variant.allowed);
                    }
                    if (variant.allowed) {
                        assert.strictEqual(cache.revalidatedPolicy(variant.request, undefined).policy, cache);
                    } else {
                        assert.throws(() => cache.revalidatedPolicy(variant.request, undefined), /Response headers missing/);
                    }
                }
            });
        }

        it('rejects Vary wildcard fallback', function() {
            const cache = new CachePolicy(request, withHeaders(response, { vary: '*' }));
            cache.now = () => cache._responseTime;
            assert.strictEqual(cache.revalidatedPolicy(request, { status: 503, headers: {} }).modified, true);
        });

        it('does not fall back without a positive stale-if-error directive', function() {
            for (const directive of ['', ', stale-if-error=0', ', stale-if-error=invalid']) {
                const cache = new CachePolicy(request, withHeaders(response, { age: '0', 'cache-control': `max-age=60${directive}` }));
                cache.now = () => cache._responseTime;
                assert.strictEqual(cache.revalidatedPolicy(request, { status: 503, headers: {} }).modified, true);
            }
        });

        it('stops fallback at the end of the stale-if-error window', function() {
            const cache = new CachePolicy(request, withHeaders(response, { age: '101' }));
            cache.now = () => cache._responseTime;
            assert.strictEqual(cache.revalidatedPolicy(request, { status: 503, headers: {} }).modified, true);
        });

        it('allows successful validation of restricted responses', function() {
            for (const directive of ['no-cache', 'must-revalidate', 'proxy-revalidate', 's-maxage=1']) {
                const cache = new CachePolicy(request, withHeaders(response, { 'cache-control': `max-age=1, ${directive}` }));
                cache.now = () => cache._responseTime;
                const result = cache.revalidatedPolicy(request, { status: 304, headers: { etag: '"matching"' } });
                assert.strictEqual(result.modified, false);
                assert.strictEqual(result.matches, true);
            }
        });
    });
});
