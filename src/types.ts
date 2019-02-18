export interface ICachePolicyFields {
    _cacheHeuristic: number;
    _host?: string;
    _immutableMinTtl: number;
    _isShared: boolean;
    _method: string;
    _noAuthorization: boolean;
    _reqHeaders?: IRequestHeaders;
    _reqcc: IRequestCacheControl;
    _resHeaders: IResponseHeaders;
    _rescc: IResponseCacheControl;
    _responseTime: number;
    _status: number;
    _url?: string;
}

interface IHeadersBase {
    [index: string]: string | undefined;
    'cache-control'?: string;
    pragma?: string;
}

export interface IRequestHeaders extends IHeadersBase {
    authorization?: string;
    host?: string;
}

export interface IResponseHeaders extends IHeadersBase {
    'last-modified'?: string;
    age?: string;
    etag?: string;
    vary?: string;
    expires?: string;
    'set-cookie'?: string;
}

export type Headers = IRequestHeaders | IResponseHeaders;

interface IBaseCacheControl {
    [index: string]: string | true | undefined;
    'max-age'?: string;
    'no-cache'?: true;
    'no-store'?: true;
}

export interface IRequestCacheControl extends IBaseCacheControl {
    'max-stale'?: true | string;
    'min-fresh'?: string;
    'no-transform'?: true;
    'only-if-cached'?: true;
}

export interface IResponseCacheControl extends IBaseCacheControl {
    'must-revalidate'?: true;
    'no-transform'?: true;
    'proxy-revalidate'?: true;
    's-maxage'?: string;
    private?: true;
    public?: true;
    'pre-check'?: string;
    'post-check'?: string;
    immutable?: true;
}

export type CacheControl = IRequestCacheControl | IResponseCacheControl;

export type HttpMethod =
    | 'GET'
    | 'HEAD'
    | 'POST'
    | 'PUT'
    | 'DELETE'
    | 'CONNECT'
    | 'OPTIONS'
    | 'TRACE'
    | 'PATCH';

export interface IRequest {
    method?: HttpMethod;
    headers?: IRequestHeaders;
    url?: string;
}

export interface IResponse {
    headers?: IResponseHeaders;
    status?: number;
    body?: any;
}

export interface ICachePolicyObject {
    ch: number;
    h?: string;
    imm?: number;
    sh: boolean;
    m: HttpMethod;
    a: boolean;
    reqh?: IRequestHeaders;
    reqcc: IRequestCacheControl;
    resh: IResponseHeaders;
    rescc: IResponseCacheControl;
    t: number;
    st: number;
    u?: string;
    v: 1;
}
