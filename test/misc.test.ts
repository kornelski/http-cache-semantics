import CachePolicy from '../src';

describe('Other', () => {
    it('Thaw wrong object', () => {
        expect(() => {
            CachePolicy.fromObject({} as any);
        }).toThrow();
    });

    it('Missing headers', () => {
        expect(() => {
            new CachePolicy({} as Request, undefined as unknown as Response);
        }).toThrow();
        expect(() => {
            new CachePolicy({ headers: {} } as Request, {} as Response);
        }).toThrow();

        const cache = new CachePolicy(
            new Request('http://localhost/'),
            new Response()
        );
        expect(() => {
            cache.satisfiesWithoutRevalidation({} as Request);
        }).toThrow();
        expect(() => {
            cache.revalidatedPolicy(
                {} as Request,
                undefined as unknown as Response
            );
        }).toThrow();
        expect(() => {
            cache.revalidatedPolicy({ headers: {} } as Request, {} as Response);
        }).toThrow();
    });

    it('GitHub response with small clock skew', () => {
        const res = new Response(null, {
            headers: {
                server: 'GitHub.com',
                date: new Date(Date.now() - 77 * 1000).toUTCString(),
                'content-type': 'application/json; charset=utf-8',
                'transfer-encoding': 'chunked',
                connection: 'close',
                status: '200 OK',
                'x-ratelimit-limit': '5000',
                'x-ratelimit-remaining': '4836',
                'x-ratelimit-reset': '1524313615',
                'cache-control': 'private, max-age=60, s-maxage=60',
                vary: 'Accept, Authorization, Cookie, X-GitHub-OTP',
                etag: 'W/"4876f954d40e3efc6d32aab08b9bdc47"',
                'x-oauth-scopes':
                    'public_repo, read:user, repo:invite, repo:status, repo_deployment',
                'x-accepted-oauth-scopes': '',
                'x-github-media-type': 'github.v3',
                link: '<https://api.github.com/user/4757745/starred?per_page=1&page=2>; rel="next", <https://api.github.com/user/4757745/starred?per_page=1&page=1120>; rel="last"',
                'access-control-expose-headers':
                    'ETag, Link, Retry-After, X-GitHub-OTP, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-OAuth-Scopes, X-Accepted-OAuth-Scopes, X-Poll-Interval',
                'access-control-allow-origin': '*',
                'strict-transport-security':
                    'max-age=31536000; includeSubdomains; preload',
                'x-frame-options': 'deny',
                'x-content-type-options': 'nosniff',
                'x-xss-protection': '1; mode=block',
                'referrer-policy':
                    'origin-when-cross-origin, strict-origin-when-cross-origin',
                'content-security-policy': "default-src 'none'",
                'x-runtime-rack': '0.051653',
                'content-encoding': 'gzip',
                'x-github-request-id': 'C6EE:12E7:3E6CA0D:87F0004:5ADB2B35',
            },
        });

        const req = new Request('https://github.com', {
            headers: {},
        });

        const c = new CachePolicy(req, res, {
            shared: false,
            // @ts-ignore
            trustServerDate: false,
        });
        expect(c.satisfiesWithoutRevalidation(req)).toBeTruthy();
    });
});
