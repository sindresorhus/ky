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
- Hooks


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
		throw new HTTPError('Fetch error:', response.statusText);
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

#### hooks

Type: `Object<string, Function[]>`<br>
Default: `{beforeRequest: []}`

Hooks allow modifications during the request lifecycle. Hook functions may be async and are run serially.

##### hooks.beforeRequest

Type: `Function[]`<br>
Default: `[]`

This hook enables you to modify the request right before it is sent. Ky will make no further changes to the request after this. The hook function receives the normalized options as the first argument. You could, for example, modify `options.headers` here.

### throwHttpErrors

Type: `boolean`<br>
Default: `true`

Throw a `HTTPError` for error responses (non-2xx status codes).

Setting this to `false` may be useful if you are checking for resource availability and are expecting error responses.

### ky.extend(defaultOptions)

Create a new `ky` instance with some defaults overridden with your own.

#### defaultOptions

Type: `Object`

### HTTPError

Exposed for `instanceof` checks. The error has a `response` property with the [`Response` object](https://developer.mozilla.org/en-US/docs/Web/API/Response).

### TimeoutError

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


## FAQ

#### How is it different from [`got`](https://github.com/sindresorhus/got)

See my answer [here](https://twitter.com/sindresorhus/status/1037406558945042432). Got is maintained by the same people as Ky.

#### How is it different from [`axios`](https://github.com/axios/axios)?

See my answer [here](https://twitter.com/sindresorhus/status/1037763588826398720).

#### How is it different from [`r2`](https://github.com/mikeal/r2)?

See my answer in [#10](https://github.com/sindresorhus/ky/issues/10).

#### What does `ky` mean?

It's just a random short npm package name I managed to get. It does, however, have a meaning in Japanese:

> A form of text-able slang, KY is an abbreviation for 空気読めない (kuuki yomenai), which literally translates into “cannot read the air.” It's a phrase applied to someone who misses the implied meaning.


## Browser support

The latest version of Chrome, Firefox, and Safari.


## Related

- [got](https://github.com/sindresorhus/got) - Simplified HTTP requests for Node.js


## Maintainers

- [Sindre Sorhus](https://github.com/sindresorhus)
- [Szymon Marczak](https://github.com/szmarczak)


## License

MIT
