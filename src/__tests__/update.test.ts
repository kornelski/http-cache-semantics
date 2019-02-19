import CachePolicy = require('..');

const simpleRequest: CachePolicy.Request = {
    headers: {
        connection: 'close',
        host: 'www.w3c.org',
    },
    method: 'GET',
    url: '/Protocols/rfc2616/rfc2616-sec14.html',
};

function withHeaders(
    request: CachePolicy.Request,
    headers: CachePolicy.RequestHeaders
): CachePolicy.Request {
    return { ...request, headers: { ...request.headers, ...headers } };
}

const cacheableResponse: CachePolicy.Response = {
    headers: { 'cache-control': 'max-age=111' },
};

const etaggedResponse: CachePolicy.Response = {
    headers: { etag: '"123456789"', ...cacheableResponse.headers },
};

const weakTaggedResponse: CachePolicy.Response = {
    headers: { etag: 'W/"123456789"', ...cacheableResponse.headers },
};

const lastModifiedResponse: CachePolicy.Response = {
    headers: {
        'last-modified': 'Tue, 15 Nov 1994 12:45:26 GMT',
        ...cacheableResponse.headers,
    },
};

const multiValidatorResponse: CachePolicy.Response = {
    headers: { ...etaggedResponse.headers, ...lastModifiedResponse.headers },
};

function notModifiedResponseHeaders(
    firstRequest: CachePolicy.Request,
    firstResponse: CachePolicy.Response,
    secondRequest: CachePolicy.Request,
    secondResponse: CachePolicy.Response
) {
    const cache = new CachePolicy(firstRequest, firstResponse);
    const headers = cache.revalidationHeaders(secondRequest);
    const { policy: newCache, modified } = cache.revalidatedPolicy(
        { headers },
        secondResponse
    );
    if (modified) {
        return;
    }
    return newCache.responseHeaders();
}

function expectUpdates(
    firstRequest: CachePolicy.Request,
    firstResponse: CachePolicy.Response,
    secondRequest: CachePolicy.Request,
    secondResponse: CachePolicy.Response
) {
    const headers = notModifiedResponseHeaders(
        firstRequest,
        withHeaders(firstResponse, { foo: 'original', 'x-other': 'original' }),
        secondRequest,
        withHeaders(secondResponse, {
            foo: 'updated',
            'x-ignore-new': 'ignoreme',
        })
    ) as CachePolicy.Headers;

    expect(headers).toBeDefined();
    expect(headers).toMatchObject({
        foo: 'updated',
        'x-other': 'original',
    });
    expect(headers).not.toHaveProperty('x-ignore-new');
    expect(headers.etag).toEqual(
        (secondResponse.headers as CachePolicy.Headers).etag
    );
}

test('Matching etags are updated', () => {
    expectUpdates(
        simpleRequest,
        etaggedResponse,
        simpleRequest,
        etaggedResponse
    );
});

test('Matching weak etags are updated', () => {
    expectUpdates(
        simpleRequest,
        weakTaggedResponse,
        simpleRequest,
        weakTaggedResponse
    );
});

test('Matching lastmod are updated', () => {
    expectUpdates(
        simpleRequest,
        lastModifiedResponse,
        simpleRequest,
        lastModifiedResponse
    );
});

test('Both matching are updated', () => {
    expectUpdates(
        simpleRequest,
        multiValidatorResponse,
        simpleRequest,
        multiValidatorResponse
    );
});

test('Checks status', () => {
    const response304 = { ...multiValidatorResponse, status: 304 };
    const response200 = { ...multiValidatorResponse, status: 200 };
    expectUpdates(
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

test('Skips update of content-length', () => {
    const etaggedResponseWithLength1 = withHeaders(etaggedResponse, {
        'content-length': '1',
    });
    const etaggedResponseWithLength2 = withHeaders(etaggedResponse, {
        'content-length': '2',
    });
    const headers = notModifiedResponseHeaders(
        simpleRequest,
        etaggedResponseWithLength1,
        simpleRequest,
        etaggedResponseWithLength2
    );
    expect(headers).toHaveProperty('content-length', '1');
});

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

describe("Ignored if validator doesn't match", () => {
    test('bad etag', () => {
        expect(
            notModifiedResponseHeaders(
                simpleRequest,
                etaggedResponse,
                simpleRequest,
                withHeaders(etaggedResponse, { etag: '"other"' })
            )
        ).toBeFalsy();
    });

    test('bad last-modified', () => {
        expect(
            notModifiedResponseHeaders(
                simpleRequest,
                lastModifiedResponse,
                simpleRequest,
                withHeaders(lastModifiedResponse, {
                    'last-modified': 'dunno',
                })
            )
        ).toBeFalsy();
    });
});

test('new response does not contain a validator', () => {
    const blank = { headers: {} };
    expect(
        new CachePolicy(blank, blank).revalidatedPolicy(blank, blank).matches
    ).toBeTruthy();
});
