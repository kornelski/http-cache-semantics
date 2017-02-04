# Can I cache this?

`CachePolicy` tells when responses can be reused from a cache, taking into account [HTTP RFC 7234](http://httpwg.org/specs/rfc7234.html) rules for user agents and shared caches. It's aware of many tricky details such as the `Vary` header, proxy revalidation, and authenticated responses.

## Usage

Cacheability of an HTTP response depends on how it was requested, so both `request` and `response` are required to create the policy.

```js
const policy = new CachePolicy(request, response, options);

if (!policy.storable()) {
    // throw the response away, it's not usable at all
    return;
}

// Cache the data AND the policy object in your cache
// (this is pseudocode, roll your own cache (lru-cache package works))
letsPretendThisIsSomeCache.set(request.url, {policy, response}, policy.timeToLive());
```

```js
// And later, when you receive a new request:
const {policy, response} = letsPretendThisIsSomeCache.get(newRequest.url);

// It's not enough that it exists in the cache, it has to match the new request, too:
if (policy && policy.satisfiesWithoutRevalidation(newRequest)) {
    // OK, the previous response can be used to respond to the `newRequest`.
    // Response headers have to be updated, e.g. to add Age and remove uncacheable headers.
    response.headers = policy.responseHeaders();
    return response;
}
```

It may be surprising, but it's not enough for an HTTP response to be [fresh](#yo-fresh) to satisfy a request. It may need to match request headers specified in `Vary`. Even a matching fresh response may still not be usable if the new request restricted cacheability, etc.

The key method is `satisfiesWithoutRevalidation(newRequest)`, which checks whether the `newRequest` is compatible with the original request and whether all caching conditions are met.

### Constructor options

Request and response must have a `headers` property with all header names in lower case. `url`, `status` and `method` are optional (defaults are any URL, status `200`, and `GET` method).

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
    ignoreCargoCult: false,
};
```

If `options.shared` is true (default), then response is evaluated from perspective of a shared cache (i.e. `private` is not cacheable and `s-maxage` is respected). If `options.shared` is false, then response is evaluated from perspective of a single-user cache (i.e. `private` is cacheable and `s-maxage` is ignored).

`options.cacheHeuristic` is a fraction of response's age that is used as a fallback cache duration. The default is 0.1 (10%), e.g. if a file hasn't been modified for 100 days, it'll be cached for 100*0.1 = 10 days.

If `options.ignoreCargoCult` is true, common anti-cache directives will be completely ignored if the non-standard `pre-check` and `post-check` directives are present. These two useless directives are most commonly found in bad StackOverflow answers and PHP's "session limiter" defaults.

### `storable()`

Returns `true` if the response can be stored in a cache. If it's `false` then you MUST NOT store either the request or the response.

### `satisfiesWithoutRevalidation(new_request)`

This is the most important method. Use this method to check whether the cached response is still fresh in the context of the new request.

If it returns `true`, then the given `request` matches the original response this cache policy has been created with, and the response can be reused without contacting the server. Note that the old response can't be returned without being updated, see `responseHeaders()`.

If it returns `false`, then the response may not be matching at all (e.g. it's for a different URL or method), or may require to be refreshed first.

### `responseHeaders()`

Returns updated, filtered set of response headers. Proxies MUST always remove hop-by-hop headers (such as `TE` and `Connection`) and update response age to avoid doubling cache time.

### `timeToLive()`

Returns approximate time in *milliseconds* until the response becomes stale (i.e. not fresh).

After that time (when `timeToLive() <= 0`) the response might not be usable without revalidation. However, there are exceptions, e.g. a client can explicitly allow stale responses, so always check with `satisfiesWithoutRevalidation()`.

### `toObject()`/`fromObject(json)`

Chances are you'll want to store the `CachePolicy` object along with the cached response. `obj = policy.toObject()` gives a plain JSON-serializable object. `policy = CachePolicy.fromObject(obj)` creates an instance from it.

# Yo, FRESH

![satisfiesWithoutRevalidation](fresh.jpg)

## Implemented

* `Cache-Control` response header with all the quirks.
* `Expires` with check for bad clocks.
* `Pragma` response header.
* `Age` response header.
* `Vary` response header.
* Default cacheability of statuses and methods.
* Requests for stale data.
* Filtering of hop-by-hop headers.

## Unimplemented

* There's no API for revalidation yet.
