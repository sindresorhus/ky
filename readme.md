<div align="center">
	<br>
	<div>
		<img width="600" height="600" src="media/logo.svg" alt="ky">
	</div>
	<br>
	<br>
	<br>
</div>

> Ky is a tiny and elegant HTTP client based on the browser [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch)

[![Build Status](https://travis-ci.com/sindresorhus/ky.svg?branch=master)](https://travis-ci.com/sindresorhus/ky) [![codecov](https://codecov.io/gh/sindresorhus/ky/branch/master/graph/badge.svg)](https://codecov.io/gh/sindresorhus/ky)

Ky targets [modern browsers](#browser-support). For older browsers, you will need to transpile and use a [`fetch` polyfill](https://github.com/github/fetch). For Node.js, check out [Got](https://github.com/sindresorhus/got).

1 KB *(minified & gzipped)*, one file, and no dependencies.


## Benefits over plain `fetch`

- Simpler API
- Method shortcuts (`ky.post()`)
- Treats non-200 status codes as errors
- Retries failed requests
- JSON option
- Timeout support
- Instances with custom defaults


## Install

```
$ npm install ky
```

<a href="https://www.patreon.com/sindresorhus">
	<img src="https://c5.patreon.com/external/logo/become_a_patron_button@2x.png" width="160">
</a>


## Usage

```js
import ky from 'ky';

(async () => {
	const json = await ky.post('https://some-api.com', {json: {foo: true}}).json();

	console.log(json);
	//=> `{data: '🦄'}`
})();
```

With plain `fetch`, it would be:

```js
(async () => {
	class HTTPError extends Error {}

	const response = await fetch('https://sindresorhus.com', {
		method: 'POST',
		body: JSON.stringify({foo: true}),
		headers: {
			'content-type': 'application/json'
		}
	});

	if (!response.ok) {
		throw new HTTPError(`Fetch error:`, response.statusText);
	}

	const json = await response.json();

	console.log(json);
	//=> `{data: '🦄'}`
})();
```


## API

### ky(input, [options])

The `input` and `options` are the same as [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch), with some exceptions:

- The `credentials` option is `same-origin` by default, which is the default in the spec too, but not all browsers have caught up yet.
- Adds some more options. See below.

Returns a [`Response` object](https://developer.mozilla.org/en-US/docs/Web/API/Response) with [`Body` methods](https://developer.mozilla.org/en-US/docs/Web/API/Body#Methods) added for convenience. So you can, for example, call `ky.json()` directly on the `Response` without having to await it first. Unlike the `Body` methods of `window.Fetch`; these will throw an `HTTPError` if the response status is not in the range `200...299`.

#### options

Type: `Object`

##### json

Type: `Object`

Shortcut for sending JSON. Use this instead of the `body` option. Accepts a plain object which will be `JSON.stringify()`'d and the correct header will be set for you.

### ky.get(input, [options])
### ky.post(input, [options])
### ky.put(input, [options])
### ky.patch(input, [options])
### ky.head(input, [options])
### ky.delete(input, [options])

Sets `options.method` to the method name and makes a request.

#### baseUrl
Type: `string` `Object`

When specified, `url` will be prepended by `baseUrl`.
If you specify an absolute URL, it will skip the `baseUrl`.

Very useful when used with `ky.extend()` to create niche-specific Ky instances.

Can be a string or a [WHATWG `URL`](https://nodejs.org/api/url.html#url_class_url).

#### retry

Type: `number`<br>
Default: `2`

Retry failed requests made with one of the below methods that result in a network error or one of the below status codes.

Methods: `GET` `PUT` `HEAD` `DELETE` `OPTIONS` `TRACE`<br>
Status codes: [`408`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/408) [`413`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/413) [`429`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429) [`500`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/500) [`502`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/502) [`503`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/503) [`504`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/504)

#### timeout

Type: `number`<br>
Default: `10000`

Timeout in milliseconds for getting a response.

### ky.extend(defaultOptions)

Create a new `ky` instance with some defaults overridden with your own.

#### defaultOptions

Type: `Object`

### ky.HTTPError

Exposed for `instanceof` checks. The error has a `response` property with the [`Response` object](https://developer.mozilla.org/en-US/docs/Web/API/Response).

### ky.TimeoutError

The error thrown when the request times out.


## Tips

### Cancelation

Fetch (and hence Ky) has built-in support for request cancelation through the [`AbortController` API](https://developer.mozilla.org/en-US/docs/Web/API/AbortController). [Read more.](https://developers.google.com/web/updates/2017/09/abortable-fetch)

Example:

```js
import ky from 'ky';

const controller = new AbortController();
const {signal} = controller;

setTimeout(() => controller.abort(), 5000);

(async () => {
	try {
		console.log(await ky(url, {signal}).text());
	} catch (error) {
		if (error.name === 'AbortError') {
		  console.log('Fetch aborted');
		} else {
		  console.error('Fetch error:', error);
		}
	}
})();
```


## Browser support

The latest version of Chrome, Firefox, and Safari.


## Related

- [got](https://github.com/sindresorhus/got) - Simplified HTTP requests for Node.js


## License

MIT © [Sindre Sorhus](https://sindresorhus.com)
