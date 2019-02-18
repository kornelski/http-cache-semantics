import CachePolicy = require('..');
import { Headers, IRequest } from '../types';

const simpleRequest: IRequest = {
    headers: {
        connection: 'close',
        host: 'www.w3c.org',
        'x-custom': 'yes',
    },
    method: 'GET',
    url: '/Protocols/rfc2616/rfc2616-sec14.html',
};
function simpleRequestBut(overrides: Partial<IRequest>) {
    return { ...simpleRequest, ...overrides };
}

const cacheableResponse = { headers: { 'cache-control': 'max-age=111' } };
const etaggedResponse = {
    headers: { etag: '"123456789"', ...cacheableResponse.headers },
};
const lastModifiedResponse = {
    headers: {
        'last-modified': 'Tue, 15 Nov 1994 12:45:26 GMT',
        ...cacheableResponse.headers,
    },
};
const multiValidatorResponse = {
    headers: { ...etaggedResponse.headers, ...lastModifiedResponse.headers },
};
const alwaysVariableResponse = {
    headers: { vary: '*', ...cacheableResponse.headers },
};

function expectHeadersPassed(headers: Headers) {
    expect(headers.connection).toBeUndefined();
    expect(headers['x-custom']).toEqual('yes');
}
function expectNoValidators(headers: Headers) {
    expect(headers['if-none-match']).toBeUndefined();
    expect(headers['if-modified-since']).toBeUndefined();
}

describe('Can be revalidated?', () => {
    test('ok if method changes to HEAD', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const headers = cache.revalidationHeaders(
            simpleRequestBut({ method: 'HEAD' })
        );
        expectHeadersPassed(headers);
        expect(headers['if-none-match']).toEqual('"123456789"');
    });

    test('not if method mismatch (other than HEAD)', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const incomingRequest = simpleRequestBut({ method: 'POST' });
        const headers = cache.revalidationHeaders(incomingRequest);
        expectHeadersPassed(headers);
        expectNoValidators(headers);
    });

    test('not if url mismatch', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const incomingRequest = simpleRequestBut({ url: '/yomomma' });
        const headers = cache.revalidationHeaders(incomingRequest);
        expectHeadersPassed(headers);
        expectNoValidators(headers);
    });

    test('not if host mismatch', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const incomingRequest = simpleRequestBut({
            headers: { host: 'www.w4c.org' },
        });
        const headers = cache.revalidationHeaders(incomingRequest);
        expectNoValidators(headers);
        expect(headers['x-custom']).toBeUndefined();
    });

    test('not if vary fields prevent', () => {
        const cache = new CachePolicy(simpleRequest, alwaysVariableResponse);
        const headers = cache.revalidationHeaders(simpleRequest);
        expectHeadersPassed(headers);
        expectNoValidators(headers);
    });

    test('when entity tag validator is present', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const headers = cache.revalidationHeaders(simpleRequest);
        expectHeadersPassed(headers);
        expect(headers['if-none-match']).toEqual('"123456789"');
    });

    test('skips weak validtors on post', () => {
        const postReq = simpleRequestBut({
            headers: {
                'if-none-match': 'W/"weak", "strong", W/"weak2"',
            },
            method: 'POST',
        });
        const cache = new CachePolicy(postReq, multiValidatorResponse);
        const headers = cache.revalidationHeaders(postReq);
        expect(headers['if-none-match']).toEqual('"strong", "123456789"');
        expect(headers['if-modified-since']).toBeUndefined();
    });

    test('skips weak validtors on post 2', () => {
        const postReq = simpleRequestBut({
            headers: {
                'if-none-match': 'W/"weak"',
            },
            method: 'POST',
        });
        const cache = new CachePolicy(postReq, lastModifiedResponse);
        const headers = cache.revalidationHeaders(postReq);
        expect(headers['if-none-match']).toBeUndefined();
        expect(headers['if-modified-since']).toBeUndefined();
    });

    test('merges validtors', () => {
        const postReq = simpleRequestBut({
            headers: { 'if-none-match': 'W/"weak", "strong", W/"weak2"' },
        });
        const cache = new CachePolicy(postReq, multiValidatorResponse);
        const headers = cache.revalidationHeaders(postReq);
        expect(headers['if-none-match']).toEqual(
            'W/"weak", "strong", W/"weak2", "123456789"'
        );
        expect(headers['if-modified-since']).toEqual(
            'Tue, 15 Nov 1994 12:45:26 GMT'
        );
    });

    test('when last-modified validator is present', () => {
        const cache = new CachePolicy(simpleRequest, lastModifiedResponse);
        const headers = cache.revalidationHeaders(simpleRequest);
        expectHeadersPassed(headers);
        expect(headers['if-modified-since']).toEqual(
            'Tue, 15 Nov 1994 12:45:26 GMT'
        );
        expect(headers).not.toHaveProperty('warning');
    });

    test('not without validators', () => {
        const cache = new CachePolicy(simpleRequest, cacheableResponse);
        const headers = cache.revalidationHeaders(simpleRequest);
        expectHeadersPassed(headers);
        expectNoValidators(headers);
        expect(headers).not.toHaveProperty('warning');
    });

    test('113 added', () => {
        const veryOldResponse = {
            headers: {
                age: `${3600 * 72}`,
                'last-modified': 'Tue, 15 Nov 1994 12:45:26 GMT',
            },
        };

        const cache = new CachePolicy(simpleRequest, veryOldResponse);
        const headers = cache.responseHeaders();
        expect(headers.warning).toContain('113');
    });

    test('113 added to existing warning', () => {
        const warning = 'existing warning';
        const oldResponseWithWarning = {
            headers: {
                age: `${3600 * 72}`,
                'last-modified': 'Tue, 15 Nov 1994 12:45:26 GMT',
                warning,
            },
        };
        const cache = new CachePolicy(simpleRequest, oldResponseWithWarning);
        const headers = cache.responseHeaders();
        expect(headers.warning).toContain(`${warning}, 113`);
    });
});

describe('Validation request', () => {
    test('removes warnings', () => {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    warning: '199 test danger',
                },
            }
        );

        expect(cache.responseHeaders()).not.toHaveProperty('warning');
    });

    test('must contain any etag', () => {
        const cache = new CachePolicy(simpleRequest, multiValidatorResponse);
        const expected = multiValidatorResponse.headers.etag;
        const actual = cache.revalidationHeaders(simpleRequest)[
            'if-none-match'
        ];
        expect(actual).toEqual(expected);
    });

    test('merges etags', () => {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const expected = `"foo", "bar", ${etaggedResponse.headers.etag}`;
        const headers = cache.revalidationHeaders(
            simpleRequestBut({
                headers: {
                    host: 'www.w3c.org',
                    'if-none-match': '"foo", "bar"',
                },
            })
        );
        expect(headers['if-none-match']).toEqual(expected);
    });

    test('should send the Last-Modified value', () => {
        const cache = new CachePolicy(simpleRequest, multiValidatorResponse);
        const expected = multiValidatorResponse.headers['last-modified'];
        const actual = cache.revalidationHeaders(simpleRequest)[
            'if-modified-since'
        ];
        expect(actual).toEqual(expected);
    });

    test('should not send the Last-Modified value for POST', () => {
        const postReq: IRequest = {
            headers: {
                'if-modified-since': 'yesterday',
            },
            method: 'POST',
        };
        const cache = new CachePolicy(postReq, lastModifiedResponse);
        const actual = cache.revalidationHeaders(postReq)['if-modified-since'];
        expect(actual).toBeUndefined();
    });

    test('should not send the Last-Modified value for range requests', () => {
        const rangeReq: IRequest = {
            headers: {
                'accept-ranges': '1-3',
                'if-modified-since': 'yesterday',
            },
            method: 'GET',
        };
        const cache = new CachePolicy(rangeReq, lastModifiedResponse);
        const actual = cache.revalidationHeaders(rangeReq)['if-modified-since'];
        expect(actual).toBeUndefined();
    });
});
