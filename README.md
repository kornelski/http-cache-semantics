# HTTP cache semantics

`CachePolicy` object that computes properties of a HTTP response, such as whether it's fresh or stale, and how long it can be cached for. Based on RFC 7234.

## Usage

```js
const cache = new CachePolicy(request, response, options);

// Age counts from the time response has been created
const secondsFresh = cache.maxAge();
const secondsOld = cache.age();

// Current state
const currentState = cache.isFresh();
```

Cacheability of response depends on how it was requested, so both request and response are required. Both are objects with `headers` property that is an object with lowercased header names as keys, e.g.

```js
const request = {
    method: 'GET',
    headers: {
        'accept': '*/*',
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
};
```

If `options.shared` is true (default), then response is evaluated from perspective of a shared cache (i.e. `private` is not cacheable and `s-maxage` is respected). If `options.shared` is false, then response is evaluated from perspective of a single-user cache (i.e. `private` is cacheable and `s-maxage` is ignored).

## Implemented

* `Expires` with check for bad clocks
* `Cache-Control` response header
* `Pragma` response header
* `Age` response header

## Unimplemented

* Request properties are not evaluated
* `Vary` support is as lame and incomplete as in web browsers
* No support for revalidation and stale responses
