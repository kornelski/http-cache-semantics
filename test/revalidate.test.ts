import CachePolicy from '../src';

const simpleRequest = new Request(
    'http://www.w3c.org/Protocols/rfc2616/rfc2616-sec14.html',
    {
        method: 'GET',
        headers: {
            host: 'www.w3c.org',
            connection: 'close',
            'x-custom': 'yes',
        },
    }
);
function simpleRequestBut(overrides: RequestInit) {
    return new Request(simpleRequest.url, {
        ...simpleRequest,
        ...overrides,
    });
}

function mergeHeaders(a: Headers, b: Headers) {
    const headers = new Headers(a);
    b.forEach((value, key) => {
        headers.set(key, value);
    });
    return headers;
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
const alwaysVariableResponse = new Response(null, {
    headers: mergeHeaders(
        new Headers({ vary: '*' }),
        cacheableResponse.headers
    ),
});

function assertHeadersPassed(headers: Headers) {
    expect(headers.get('connection')).toBe(null);
    expect(headers.get('x-custom')).toBe('yes');
}
function assertNoValidators(headers: Headers) {
    expect(headers.get('if-none-match')).toBe(null);
    expect(headers.get('if-modified-since')).toBe(null);
}

describe('Can be revalidated?', () => {
    test('ok if method changes to HEAD', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const headers = cache.revalidationHeaders(
            simpleRequestBut({ method: 'HEAD' })
        );
        assertHeadersPassed(headers);
        expect(headers.get('if-none-match')).toBe('"123456789"');
    });

    test('not if method mismatch (other than HEAD)', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const req = simpleRequestBut({ method: 'POST' });
        const headers = cache.revalidationHeaders(req);
        assertHeadersPassed(headers);
        assertNoValidators(headers);
    });

    test('not if url mismatch', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const req = new Request('http://localhost/yomomma', {
            method: simpleRequest.method,
            headers: simpleRequest.headers,
        });
        const headers = cache.revalidationHeaders(req);
        assertHeadersPassed(headers);
        assertNoValidators(headers);
    });

    test('not if host mismatch', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const req = simpleRequestBut({
            headers: { host: 'www.w4c.org' },
        });
        const headers = cache.revalidationHeaders(req);
        assertNoValidators(headers);
        expect(headers.get('x-custom')).toBe(null);
    });

    test('not if vary fields prevent', () => {
        const cache = new CachePolicy(simpleRequest, alwaysVariableResponse);
        const headers = cache.revalidationHeaders(simpleRequest);
        assertHeadersPassed(headers);
        assertNoValidators(headers);
    });

    test('when entity tag validator is present', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const headers = cache.revalidationHeaders(simpleRequest);
        assertHeadersPassed(headers);
        expect(headers.get('if-none-match')).toBe('"123456789"');
    });

    test('skips weak validators on post', () => {
        const postReq = simpleRequestBut({
            method: 'POST',
            headers: { 'if-none-match': 'W/"weak", "strong", W/"weak2"' },
        });
        const cache = new CachePolicy(postReq, multiValidatorResponse);
        const headers = cache.revalidationHeaders(postReq);
        expect(headers.get('if-none-match')).toBe('"strong", "123456789"');
        expect(headers.get('if-modified-since')).toBe(null);
    });

    test('skips weak validators on post 2', () => {
        const postReq = simpleRequestBut({
            method: 'POST',
            headers: { 'if-none-match': 'W/"weak"' },
        });
        const cache = new CachePolicy(postReq, lastModifiedResponse);
        const headers = cache.revalidationHeaders(postReq);
        expect(headers.get('if-none-match')).toBe(null);
        expect(headers.get('if-modified-since')).toBe(null);
    });

    test('merges validators', () => {
        const postReq = simpleRequestBut({
            headers: { 'if-none-match': 'W/"weak", "strong", W/"weak2"' },
        });
        const cache = new CachePolicy(postReq, multiValidatorResponse);
        const headers = cache.revalidationHeaders(postReq);
        expect(headers.get('if-none-match')).toBe(
            'W/"weak", "strong", W/"weak2", "123456789"'
        );
        expect(headers.get('if-modified-since')).toBe(
            'Tue, 15 Nov 1994 12:45:26 GMT'
        );
    });

    test('when last-modified validator is present', () => {
        const cache = new CachePolicy(simpleRequest, lastModifiedResponse);
        const headers = cache.revalidationHeaders(simpleRequest);
        assertHeadersPassed(headers);
        expect(headers.get('if-modified-since')).toBe(
            'Tue, 15 Nov 1994 12:45:26 GMT'
        );
        expect(/113/.test(headers.get('warning') ?? '')).toBeFalsy();
    });

    test('not without validators', () => {
        const cache = new CachePolicy(simpleRequest, cacheableResponse);
        const headers = cache.revalidationHeaders(simpleRequest);
        assertHeadersPassed(headers);
        assertNoValidators(headers);
        expect(/113/.test(headers.get('warning') ?? '')).toBeFalsy();
    });

    test('113 added', () => {
        const veryOldResponse = new Response(null, {
            headers: {
                age: String(3600 * 72),
                'last-modified': 'Tue, 15 Nov 1994 12:45:26 GMT',
            },
        });

        const cache = new CachePolicy(simpleRequest, veryOldResponse);
        const headers = cache.responseHeaders();
        expect(/113/.test(headers.get('warning') ?? '')).toBeTruthy();
    });
});

describe('Validation request', () => {
    test('removes warnings', () => {
        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response(null, {
                headers: {
                    warning: '199 test danger',
                },
            })
        );

        expect(cache.responseHeaders().get('warning')).toBe(null);
    });

    test('must contain any etag', () => {
        const cache = new CachePolicy(simpleRequest, multiValidatorResponse);
        const expected = multiValidatorResponse.headers.get('etag');
        const actual = cache
            .revalidationHeaders(simpleRequest)
            .get('if-none-match');
        expect(actual).toBe(expected);
    });

    test('merges etags', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const expected = `"foo", "bar", ${etaggedResponse.headers.get('etag')}`;
        const headers = cache.revalidationHeaders(
            simpleRequestBut({
                headers: {
                    host: 'www.w3c.org',
                    'if-none-match': '"foo", "bar"',
                },
            })
        );
        expect(headers.get('if-none-match')).toBe(expected);
    });

    test('should send the Last-Modified value', () => {
        const cache = new CachePolicy(simpleRequest, multiValidatorResponse);
        const expected = multiValidatorResponse.headers.get('last-modified');
        const actual = cache
            .revalidationHeaders(simpleRequest)
            .get('if-modified-since');
        expect(actual).toBe(expected);
    });

    test('should not send the Last-Modified value for POST', () => {
        const postReq = new Request('http://localhost/', {
            method: 'POST',
            headers: { 'if-modified-since': 'yesterday' },
        });
        const cache = new CachePolicy(postReq, lastModifiedResponse);
        const actual = cache
            .revalidationHeaders(postReq)
            .get('if-modified-since');
        expect(actual).toBe(null);
    });

    test('should not send the Last-Modified value for range requests', () => {
        const rangeReq = new Request('http://localhost/', {
            method: 'GET',
            headers: {
                'accept-ranges': '1-3',
                'if-modified-since': 'yesterday',
            },
        });
        const cache = new CachePolicy(rangeReq, lastModifiedResponse);
        const actual = cache
            .revalidationHeaders(rangeReq)
            .get('if-modified-since');
        expect(actual).toBe(null);
    });
});
