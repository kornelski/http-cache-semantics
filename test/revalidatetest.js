'use strict';

const assert = require('assert');
const CachePolicy = require('..');

const simpleRequest = {
    method:'GET',
    headers:{host:'www.w3c.org'},
    url:'/Protocols/rfc2616/rfc2616-sec14.html',
};
function simpleRequestBut(overrides) {
    return Object.assign({}, simpleRequest, overrides);
}

const cacheableResponse = {headers:{'cache-control':'max-age=111'}};
const etaggedResponse = {headers:Object.assign({'etag':'"123456789"'},cacheableResponse.headers)};
const lastModifiedResponse = {headers:Object.assign({'last-modified':'Tue, 15 Nov 1994 12:45:26 GMT'},cacheableResponse.headers)};
const multiValidatorResponse = {headers:Object.assign({},etaggedResponse.headers,lastModifiedResponse.headers)};
const alwaysVariableResponse = {headers:Object.assign({'vary':'*'},cacheableResponse.headers)};

describe('Can be revalidated?', function() {
    it('ok if method changes to HEAD', function(){
       const cache = new CachePolicy(simpleRequest,etaggedResponse);
       const headers = cache.revalidationHeaders(simpleRequestBut({method:'HEAD'}));
       assert.equal(headers['if-none-match'], '"123456789"');
    });
    it('not if method mismatch (other than HEAD)',function(){
       const cache = new CachePolicy(simpleRequest,etaggedResponse);
       const incomingRequest = simpleRequestBut({method:'POST'});
       // Returns the same object unmodified, which means no custom validation
       assert.strictEqual(incomingRequest.headers, cache.revalidationHeaders(incomingRequest));
    });
    it('not if url mismatch',function(){
       const cache = new CachePolicy(simpleRequest,etaggedResponse);
       const incomingRequest = simpleRequestBut({url:'/yomomma'});
       assert.strictEqual(incomingRequest.headers, cache.revalidationHeaders(incomingRequest));
    });
    it('not if host mismatch',function(){
        const cache = new CachePolicy(simpleRequest,etaggedResponse);
        const incomingRequest = simpleRequestBut({headers:{host:'www.w4c.org'}});
        assert.strictEqual(incomingRequest.headers, cache.revalidationHeaders(incomingRequest));
    });
    it('not if vary fields prevent',function(){
       const cache = new CachePolicy(simpleRequest,alwaysVariableResponse);
       assert.strictEqual(simpleRequest.headers, cache.revalidationHeaders(simpleRequest));
    });
    it('when entity tag validator is present', function() {
        const cache = new CachePolicy(simpleRequest, etaggedResponse);
        const headers = cache.revalidationHeaders(simpleRequest);
        assert.equal(headers['if-none-match'], '"123456789"');
    });
    it('when last-modified validator is present', function() {
       const cache = new CachePolicy(simpleRequest, lastModifiedResponse);
       const headers = cache.revalidationHeaders(simpleRequest);
       assert.equal(headers['if-modified-since'], 'Tue, 15 Nov 1994 12:45:26 GMT');
    });
    it('not without validators', function() {
        const cache = new CachePolicy(simpleRequest, cacheableResponse);
        assert.strictEqual(simpleRequest.headers, cache.revalidationHeaders(simpleRequest));
    })

});

describe('Validation request', function(){
    it('must contain any etag', function(){
        const cache = new CachePolicy(simpleRequest,multiValidatorResponse);
        const expected = multiValidatorResponse.headers.etag;
        const actual = cache.revalidationHeaders(simpleRequest)['if-none-match'];
        assert.equal(actual,expected);
    });
    it('should send the Last-Modified value',function(){
        const cache = new CachePolicy(simpleRequest,multiValidatorResponse);
        const expected = multiValidatorResponse.headers['last-modified'];
        const actual = cache.revalidationHeaders(simpleRequest)['if-modified-since'];
        assert.equal(actual,expected);
    });

});
