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
function mergeHeaders(a: Headers, b: Headers) {
    const headers = new Headers(a);
    b.forEach((value, key) => {
        headers.set(key, value);
    });
    return headers;
}

function withHeaders(res: Response, headers: HeadersInit) {
    return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: mergeHeaders(res.headers, new Headers(headers)),
    });
}

const cacheableResponse = new Response(null, {
    headers: { 'cache-control': 'max-age=111' },
});
const etaggedResponse = new Response(null, {
    headers: mergeHeaders(
        new Headers({ etag: '"123456789"' }),
        cacheableResponse.headers
    ),
});
const weakTaggedResponse = new Response(null, {
    headers: mergeHeaders(
        new Headers({ etag: 'W/"123456789"' }),
        cacheableResponse.headers
    ),
});
const lastModifiedResponse = new Response(null, {
    headers: mergeHeaders(
        new Headers({ 'last-modified': 'Tue, 15 Nov 1994 12:45:26 GMT' }),
        cacheableResponse.headers
    ),
});
const multiValidatorResponse = new Response(null, {
    headers: mergeHeaders(
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
        return null;
    }
    return newCache.responseHeaders();
}

function assertUpdates(
    firstRequest: Request,
    firstResponse: Response,
    secondRequest: Request,
    secondResponse: Response
) {
    firstResponse = new Response(firstResponse.body, {
        status: 200,
        headers: withHeaders(firstResponse, {
            foo: 'original',
            'x-other': 'original',
        }).headers,
    });
    secondResponse = new Response(secondResponse.body, {
        status: 304,
        headers: withHeaders(secondResponse, {
            foo: 'updated',
            'x-ignore-new': 'ignoreme',
        }).headers,
    });

    const headers = notModifiedResponseHeaders(
        firstRequest,
        firstResponse,
        secondRequest,
        secondResponse
    );
    expect(headers).toBeTruthy();
    expect(headers?.get('foo')).toEqual('updated');
    expect(headers?.get('x-other')).toEqual('original');
    expect(headers?.get('x-ignore-new')).toBe(null);
    expect(headers?.get('etag')).toEqual(secondResponse.headers.get('etag'));
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
        const response304 = new Response(null, {
            headers: multiValidatorResponse.headers,
            status: 304,
        });
        const response200 = new Response(multiValidatorResponse.body, {
            headers: multiValidatorResponse.headers,
            statusText: multiValidatorResponse.statusText,
            status: 200,
        });
        assertUpdates(
            simpleRequest,
            multiValidatorResponse,
            simpleRequest,
            response304
        );
        expect(
            notModifiedResponseHeaders(
                simpleRequest,
                multiValidatorResponse,
                simpleRequest,
                response200
            )
        ).toBeFalsy();
    });

    test('Last-mod ignored if etag is wrong', () => {
        expect(
            notModifiedResponseHeaders(
                simpleRequest,
                multiValidatorResponse,
                simpleRequest,
                withHeaders(multiValidatorResponse, { etag: 'bad' })
            )
        ).toBeFalsy();
        expect(
            notModifiedResponseHeaders(
                simpleRequest,
                multiValidatorResponse,
                simpleRequest,
                withHeaders(multiValidatorResponse, { etag: 'W/bad' })
            )
        ).toBeFalsy();
    });

    test('Ignored if validator is missing', () => {
        expect(
            notModifiedResponseHeaders(
                simpleRequest,
                etaggedResponse,
                simpleRequest,
                cacheableResponse
            )
        ).toBeFalsy();
        expect(
            notModifiedResponseHeaders(
                simpleRequest,
                weakTaggedResponse,
                simpleRequest,
                cacheableResponse
            )
        ).toBeFalsy();
        expect(
            notModifiedResponseHeaders(
                simpleRequest,
                lastModifiedResponse,
                simpleRequest,
                cacheableResponse
            )
        ).toBeFalsy();
    });

    // TODO: fix this test
    // test('Skips update of content-length', () => {
    //     const etaggedResponseWithLenght1 = withHeaders(etaggedResponse, {
    //         'content-length': String(1),
    //     });
    //     const etaggedResponseWithLenght2 = withHeaders(etaggedResponse, {
    //         'content-length': String(2),
    //     });
    //     const headers = notModifiedResponseHeaders(
    //         simpleRequest,
    //         etaggedResponseWithLenght1,
    //         simpleRequest,
    //         etaggedResponseWithLenght2
    //     );
    //     expect(headers?.get('content-length')).toEqual('1');
    // });

    test('Ignored if validator is different', () => {
        expect(
            notModifiedResponseHeaders(
                simpleRequest,
                lastModifiedResponse,
                simpleRequest,
                etaggedResponse
            )
        ).toBeFalsy();
        expect(
            notModifiedResponseHeaders(
                simpleRequest,
                lastModifiedResponse,
                simpleRequest,
                weakTaggedResponse
            )
        ).toBeFalsy();
        expect(
            notModifiedResponseHeaders(
                simpleRequest,
                etaggedResponse,
                simpleRequest,
                lastModifiedResponse
            )
        ).toBeFalsy();
    });

    test("Ignored if validator doesn't match", () => {
        expect(
            notModifiedResponseHeaders(
                simpleRequest,
                etaggedResponse,
                simpleRequest,
                withHeaders(etaggedResponse, { etag: '"other"' })
            )
        ).toBeFalsy();
        expect(
            notModifiedResponseHeaders(
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
