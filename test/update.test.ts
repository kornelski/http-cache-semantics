import CachePolicy from '../src';

const simpleRequest = new Request(
    'http://www.w3c.org/Protocols/rfc2616/rfc2616-sec14.html',
    {
        method: 'GET',
        headers: {
            host: 'www.w3c.org',
            connection: 'close',
        },
    }
);
function withHeaders(request: Request | Response, headers: HeadersInit) {
    return Object.assign({}, request, {
        headers: Object.assign({}, request.headers, headers),
    });
}

const cacheableResponse = new Response(null, {
    headers: { 'cache-control': 'max-age=111' },
});
const etaggedResponse = new Response(null, {
    headers: Object.assign({ etag: '"123456789"' }, cacheableResponse.headers),
});
const weakTaggedResponse = new Response(null, {
    headers: Object.assign(
        { etag: 'W/"123456789"' },
        cacheableResponse.headers
    ),
});
const lastModifiedResponse = new Response(null, {
    headers: Object.assign(
        { 'last-modified': 'Tue, 15 Nov 1994 12:45:26 GMT' },
        cacheableResponse.headers
    ),
});
const multiValidatorResponse = new Response(null, {
    headers: Object.assign(
        {},
        etaggedResponse.headers,
        lastModifiedResponse.headers
    ),
});

function notModifiedResponseHeaders(
    firstRequest: Request,
    firstResponse: Response,
    secondRequest: Request,
    secondResponse: Response
) {
    const cache = new CachePolicy(firstRequest, firstResponse);
    const headers = cache.revalidationHeaders(secondRequest);
    const { policy: newCache, modified } = cache.revalidatedPolicy(
        new Request('http://localhost/', { headers }),
        secondResponse
    );
    if (modified) {
        return false;
    }
    return newCache.responseHeaders();
}

function assertUpdates(
    firstRequest: Request,
    firstResponse: Response,
    secondRequest: Request,
    secondResponse: Response
) {
    firstResponse = withHeaders(firstResponse, {
        foo: 'original',
        'x-other': 'original',
    });
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
    expect(headers).toBeTruthy();
    expect(headers['foo']).toEqual('updated');
    expect(headers['x-other']).toEqual('original');
    expect(headers['x-ignore-new']).toBeUndefined();
    expect(headers['etag']).toEqual(secondResponse.headers.get('etag'));
}

describe('Update revalidated', () => {
    test('Matching etags are updated', () => {
        assertUpdates(
            simpleRequest,
            etaggedResponse,
            simpleRequest,
            etaggedResponse
        );
    });

    test('Matching weak etags are updated', () => {
        assertUpdates(
            simpleRequest,
            weakTaggedResponse,
            simpleRequest,
            weakTaggedResponse
        );
    });

    test('Matching lastmod are updated', () => {
        assertUpdates(
            simpleRequest,
            lastModifiedResponse,
            simpleRequest,
            lastModifiedResponse
        );
    });

    test('Both matching are updated', () => {
        assertUpdates(
            simpleRequest,
            multiValidatorResponse,
            simpleRequest,
            multiValidatorResponse
        );
    });

    test('Checks status', () => {
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
        expect(
            !notModifiedResponseHeaders(
                simpleRequest,
                multiValidatorResponse,
                simpleRequest,
                response200
            )
        ).toBeFalsy();
    });

    test('Last-mod ignored if etag is wrong', () => {
        expect(
            !notModifiedResponseHeaders(
                simpleRequest,
                multiValidatorResponse,
                simpleRequest,
                withHeaders(multiValidatorResponse, { etag: 'bad' })
            )
        ).toBeFalsy();
        expect(
            !notModifiedResponseHeaders(
                simpleRequest,
                multiValidatorResponse,
                simpleRequest,
                withHeaders(multiValidatorResponse, { etag: 'W/bad' })
            )
        ).toBeFalsy();
    });

    test('Ignored if validator is missing', () => {
        expect(
            !notModifiedResponseHeaders(
                simpleRequest,
                etaggedResponse,
                simpleRequest,
                cacheableResponse
            )
        ).toBeFalsy();
        expect(
            !notModifiedResponseHeaders(
                simpleRequest,
                weakTaggedResponse,
                simpleRequest,
                cacheableResponse
            )
        ).toBeFalsy();
        expect(
            !notModifiedResponseHeaders(
                simpleRequest,
                lastModifiedResponse,
                simpleRequest,
                cacheableResponse
            )
        ).toBeFalsy();
    });

    test('Skips update of content-length', () => {
        const etaggedResponseWithLenght1 = withHeaders(etaggedResponse, {
            'content-length': String(1),
        });
        const etaggedResponseWithLenght2 = withHeaders(etaggedResponse, {
            'content-length': String(2),
        });
        const headers = notModifiedResponseHeaders(
            simpleRequest,
            etaggedResponseWithLenght1,
            simpleRequest,
            etaggedResponseWithLenght2
        );
        expect(headers['content-length']).toEqual(1);
    });

    test('Ignored if validator is different', () => {
        expect(
            !notModifiedResponseHeaders(
                simpleRequest,
                lastModifiedResponse,
                simpleRequest,
                etaggedResponse
            )
        ).toBeFalsy();
        expect(
            !notModifiedResponseHeaders(
                simpleRequest,
                lastModifiedResponse,
                simpleRequest,
                weakTaggedResponse
            )
        ).toBeFalsy();
        expect(
            !notModifiedResponseHeaders(
                simpleRequest,
                etaggedResponse,
                simpleRequest,
                lastModifiedResponse
            )
        ).toBeFalsy();
    });

    test("Ignored if validator doesn't match", () => {
        expect(
            !notModifiedResponseHeaders(
                simpleRequest,
                etaggedResponse,
                simpleRequest,
                withHeaders(etaggedResponse, { etag: '"other"' })
            )
        ).toBeFalsy();
        expect(
            !notModifiedResponseHeaders(
                simpleRequest,
                lastModifiedResponse,
                simpleRequest,
                withHeaders(lastModifiedResponse, { 'last-modified': 'dunno' })
            )
        ).toBeFalsy();
    });

    test('staleIfError revalidate, no response', () => {
        const cacheableStaleResponse = new Response(null, {
            headers: { 'cache-control': 'max-age=200, stale-if-error=300' },
        });
        const cache = new CachePolicy(simpleRequest, cacheableStaleResponse);

        const { policy, modified } = cache.revalidatedPolicy(
            simpleRequest,
            null as unknown as Response
        );
        expect(policy).toBe(cache);
        expect(modified).toBeFalsy();
    });

    test('staleIfError revalidate, server error', () => {
        const cacheableStaleResponse = new Response(null, {
            headers: { 'cache-control': 'max-age=200, stale-if-error=300' },
        });
        const cache = new CachePolicy(simpleRequest, cacheableStaleResponse);

        const { policy, modified } = cache.revalidatedPolicy(
            simpleRequest,
            new Response(null, { status: 500 })
        );
        expect(policy).toBe(cache);
        expect(modified).toBeFalsy();
    });
});
