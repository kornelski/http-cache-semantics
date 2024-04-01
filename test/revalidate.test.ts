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
    return Object.assign({}, simpleRequest, overrides);
}

const cacheableResponse = new Response(null, {
    headers: { 'cache-control': 'max-age=111' },
});
const etaggedResponse = new Response(null, {
    headers: Object.assign({ etag: '"123456789"' }, cacheableResponse.headers),
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
const alwaysVariableResponse = new Response(null, {
    headers: Object.assign({ vary: '*' }, cacheableResponse.headers),
});

function assertHeadersPassed(headers: Record<string, string>) {
    expect(headers.connection).toBeUndefined();
    expect(headers['x-custom']).toBe('yes');
}
function assertNoValidators(headers: Record<string, string>) {
    expect(headers['if-none-match']).toBeUndefined();
    expect(headers['if-modified-since']).toBeUndefined();
}

describe('Can be revalidated?', () => {
    test('ok if method changes to HEAD', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const headers = cache.revalidationHeaders(
            simpleRequestBut({ method: 'HEAD' })
        );
        assertHeadersPassed(headers);
        expect(headers['if-none-match']).toBe('"123456789"');
    });

    test('not if method mismatch (other than HEAD)', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const incomingRequest = simpleRequestBut({ method: 'POST' });
        const headers = cache.revalidationHeaders(incomingRequest);
        assertHeadersPassed(headers);
        assertNoValidators(headers);
    });

    test('not if url mismatch', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const incomingRequest = Object.assign(
            {},
            simpleRequest,
            new Request('http://localhost/yomomma')
        );
        const headers = cache.revalidationHeaders(incomingRequest);
        assertHeadersPassed(headers);
        assertNoValidators(headers);
    });

    test('not if host mismatch', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const incomingRequest = simpleRequestBut({
            headers: { host: 'www.w4c.org' },
        });
        const headers = cache.revalidationHeaders(incomingRequest);
        assertNoValidators(headers);
        expect(headers['x-custom']).toBeUndefined();
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
        expect(headers['if-none-match']).toBe('"123456789"');
    });

    test('skips weak validators on post', () => {
        const postReq = simpleRequestBut({
            method: 'POST',
            headers: { 'if-none-match': 'W/"weak", "strong", W/"weak2"' },
        });
        const cache = new CachePolicy(postReq, multiValidatorResponse);
        const headers = cache.revalidationHeaders(postReq);
        expect(headers['if-none-match']).toBe('"strong", "123456789"');
        expect(headers['if-modified-since']).toBeUndefined();
    });

    test('skips weak validators on post 2', () => {
        const postReq = simpleRequestBut({
            method: 'POST',
            headers: { 'if-none-match': 'W/"weak"' },
        });
        const cache = new CachePolicy(postReq, lastModifiedResponse);
        const headers = cache.revalidationHeaders(postReq);
        expect(headers['if-none-match']).toBeUndefined();
        expect(headers['if-modified-since']).toBeUndefined();
    });

    test('merges validators', () => {
        const postReq = simpleRequestBut({
            headers: { 'if-none-match': 'W/"weak", "strong", W/"weak2"' },
        });
        const cache = new CachePolicy(postReq, multiValidatorResponse);
        const headers = cache.revalidationHeaders(postReq);
        expect(headers['if-none-match']).toBe(
            'W/"weak", "strong", W/"weak2", "123456789"'
        );
        expect(headers['if-modified-since']).toBe(
            'Tue, 15 Nov 1994 12:45:26 GMT'
        );
    });

    test('when last-modified validator is present', () => {
        const cache = new CachePolicy(simpleRequest, lastModifiedResponse);
        const headers = cache.revalidationHeaders(simpleRequest);
        assertHeadersPassed(headers);
        expect(headers['if-modified-since']).toBe(
            'Tue, 15 Nov 1994 12:45:26 GMT'
        );
        expect(/113/.test(headers.warning)).toBeFalsy();
    });

    test('not without validators', () => {
        const cache = new CachePolicy(simpleRequest, cacheableResponse);
        const headers = cache.revalidationHeaders(simpleRequest);
        assertHeadersPassed(headers);
        assertNoValidators(headers);
        expect(/113/.test(headers.warning)).toBeFalsy();
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
        expect(/113/.test(headers.warning)).toBeTruthy();
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

        expect(cache.responseHeaders().warning).toBeUndefined();
    });

    test('must contain any etag', () => {
        const cache = new CachePolicy(simpleRequest, multiValidatorResponse);
        const expected = multiValidatorResponse.headers.get('etag');
        const actual =
            cache.revalidationHeaders(simpleRequest)['if-none-match'];
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
        expect(headers['if-none-match']).toBe(expected);
    });

    test('should send the Last-Modified value', () => {
        const cache = new CachePolicy(simpleRequest, multiValidatorResponse);
        const expected = multiValidatorResponse.headers.get('last-modified');
        const actual =
            cache.revalidationHeaders(simpleRequest)['if-modified-since'];
        expect(actual).toBe(expected);
    });

    test('should not send the Last-Modified value for POST', () => {
        const postReq = new Request('http://localhost/', {
            method: 'POST',
            headers: { 'if-modified-since': 'yesterday' },
        });
        const cache = new CachePolicy(postReq, lastModifiedResponse);
        const actual = cache.revalidationHeaders(postReq)['if-modified-since'];
        expect(actual).toBeUndefined();
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
        const actual = cache.revalidationHeaders(rangeReq)['if-modified-since'];
        expect(actual).toBeUndefined();
    });
});
