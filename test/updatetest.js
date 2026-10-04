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
});

describe('stale-if-error request matching', function() {
    const request = withHeaders(simpleRequest, { 'accept-language': 'en' });
    const response = {
        status: 200,
        headers: {
            'cache-control': 'max-age=60, stale-if-error=60',
            age: '61',
            vary: 'accept-language',
            etag: '"123456789"',
        },
    };

    function staleCache() {
        const cache = new CachePolicy(request, response);
        assert(cache.storable());
        assert(cache.stale());
        return cache;
    }

    const mismatchedRequests = {
        Vary: withHeaders(request, { 'accept-language': 'fr' }),
        URL: Object.assign({}, request, { url: '/other' }),
        Host: withHeaders(request, { host: 'www.w4c.org' }),
        method: Object.assign({}, request, { method: 'POST' }),
    };

    for (const [field, incomingRequest] of Object.entries(mismatchedRequests)) {
        it(`does not reuse a stale response after a ${field} mismatch`, function() {
            const cache = staleCache();
            const revalidationRequest = Object.assign({}, incomingRequest, {
                headers: cache.revalidationHeaders(incomingRequest),
            });
            assert.strictEqual(revalidationRequest.headers['if-none-match'], undefined);

            const result = cache.revalidatedPolicy(revalidationRequest, {
                status: 503,
                headers: {},
            });
            assert.strictEqual(result.modified, true);
            assert.strictEqual(result.matches, false);
            assert.notStrictEqual(result.policy, cache);
            assert.strictEqual(result.policy.toObject().st, 503);
        });
    }

    for (const method of ['GET', 'HEAD']) {
        it(`reuses a stale response for matching ${method} requests on server errors`, function() {
            const cache = staleCache();
            const incomingRequest = Object.assign({}, request, { method });
            const revalidationRequest = Object.assign({}, incomingRequest, {
                headers: cache.revalidationHeaders(incomingRequest),
            });
            assert.strictEqual(revalidationRequest.headers['if-none-match'], response.headers.etag);

            for (const status of [500, 502, 503, 504]) {
                assert.deepStrictEqual(
                    cache.revalidatedPolicy(revalidationRequest, { status, headers: {} }),
                    { policy: cache, modified: false, matches: true },
                    `status ${status}`
                );
            }
        });
    }

    it('requires a matching request when no response is available', function() {
        const cache = staleCache();
        for (const failedResponse of [null, undefined]) {
            assert.deepStrictEqual(
                cache.revalidatedPolicy(request, failedResponse),
                { policy: cache, modified: false, matches: true }
            );
            assert.throws(
                () => cache.revalidatedPolicy(mismatchedRequests.Vary, failedResponse),
                /Response headers missing/
            );
        }
    });
});
