# HTTP cache semantics

`CachePolicy` object that computes properties of a HTTP response, such as whether it's fresh or stale, and how long it can be cached for. Based on RFC 7234.

## Usage

```js
const cache = new CachePolicy(request, response, options);

// Age counts from the time response has been created
const secondsFresh = cache.maxAge();
const secondsOld = cache.age();

// Current state
const outOfDate = cache.stale();
```

Cacheability of response depends on how it was requested, so both request and response are required. Both are objects with `headers` property that is an object with lowercased header names as keys, e.g.

```js
const request = {
    url: '/',
    method: 'GET',
    headers: {
        accept: '*/*',
    },
};

const response = {
    status: 200,
    headers: {
        'cache-control': 'public, max-age=7234',
    },
};

const options = {
    shared: true,
    cacheHeuristic: 0.1,
};
```

If `options.shared` is true (default), then response is evaluated from perspective of a shared cache (i.e. `private` is not cacheable and `s-maxage` is respected). If `options.shared` is false, then response is evaluated from perspective of a single-user cache (i.e. `private` is cacheable and `s-maxage` is ignored).

`options.cacheHeuristic` is a fraction of response's age that is used as a fallback cache duration. The default is 0.1 (10%), e.g. if a file hasn't been modified for 100 days, it'll be cached for 100*0.1 = 10 days.

### `satisfiesWithoutRevalidation(request)`

If it returns `true`, then the given `request` matches the response this cache policy has been created with, and the existing response can be used without contacting the server.

If it returns `false`, then the response may not be matching at all (e.g. it's different URL or method), or may require to be refreshed first.

### `storable()`

Returns `true` if the response can be stored in a cache. If it's `false` then you MUST NOT store either request or the response.

### `stale()`

Returns `true` if the response is stale (i.e. not fresh).

It generally means the response can't be used any more without revalidation with the server. However, there are exceptions, e.g. client can explicitly allow stale responses. A fresh response still may not be used if other conditions—such as `Vary`—are not satisfied.

## Implemented

* `Expires` with check for bad clocks
* `Cache-Control` response header
* `Pragma` response header
* `Age` response header
* Default cacheability of statuses and methods
* Basic support for `Vary`

## Unimplemented

* No support for revalidation and stale responses
