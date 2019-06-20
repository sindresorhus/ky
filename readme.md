<div align="center">
	<br>
	<div>
		<img width="600" height="600" src="media/logo.svg" alt="ky">
	</div>
	<p align="center">Huge thanks to <a href="https://lunanode.com"><img src="https://sindresorhus.com/assets/thanks/lunanode-logo.svg" width="170"></a> for sponsoring me!</p>
	<br>
	<br>
	<br>
	<br>
</div>

> Ky is a tiny and elegant HTTP client based on the browser [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch)

[![Build Status](https://travis-ci.com/sindresorhus/ky.svg?branch=master)](https://travis-ci.com/sindresorhus/ky) [![codecov](https://codecov.io/gh/sindresorhus/ky/branch/master/graph/badge.svg)](https://codecov.io/gh/sindresorhus/ky) [![](https://badgen.net/bundlephobia/minzip/ky)](https://bundlephobia.com/result?p=ky)

Ky targets [modern browsers](#browser-support) and [Deno](https://github.com/denoland/deno). For older browsers, you will need to transpile and use a [`fetch` polyfill](https://github.com/github/fetch). For Node.js, check out [Got](https://github.com/sindresorhus/got). For isomorphic needs (like SSR), check out [`ky-universal`](https://github.com/sindresorhus/ky-universal).

It's just a tiny file with no dependencies.


## Benefits over plain `fetch`

- Simpler API
- Method shortcuts (`ky.post()`)
- Treats non-2xx status codes as errors
- Retries failed requests
- JSON option
- Timeout support
- URL prefix option
- Instances with custom defaults
- Hooks


## Install

```
$ npm install ky
```

###### Download

- [Normal](https://cdn.jsdelivr.net/npm/ky/index.js)
- [Minified](https://cdn.jsdelivr.net/npm/ky/index.min.js)

###### CDN

- [jsdelivr](https://www.jsdelivr.com/package/npm/ky)
- [unpkg](https://unpkg.com/ky)


## Usage

```js
import ky from 'ky';

(async () => {
	const parsed = await ky.post('https://example.com', {json: {foo: true}}).json();

	console.log(parsed);
	//=> `{data: '🦄'}`
})();
```

With plain `fetch`, it would be:

```js
(async () => {
	class HTTPError extends Error {}

	const response = await fetch('https://example.com', {
		method: 'POST',
		body: JSON.stringify({foo: true}),
		headers: {
			'content-type': 'application/json'
		}
	});

	if (!response.ok) {
		throw new HTTPError('Fetch error:', response.statusText);
	}

	const parsed = await response.json();

	console.log(parsed);
	//=> `{data: '🦄'}`
})();
```

If you are using [Deno](https://github.com/denoland/deno), import Ky from a URL. For example, using a CDN:

```js
import ky from 'https://unpkg.com/ky/index.js';
```

In environments that do not support `import`, you can load `ky` in [UMD format](https://medium.freecodecamp.org/anatomy-of-js-module-systems-and-building-libraries-fadcd8dbd0e). For example, using `require()`:

```js
const ky = require('ky/umd').default;
```

With the UMD version, it's also easy to use `ky` [without a bundler](#how-do-i-use-this-without-a-bundler-like-webpack) or module system.


## API

### ky(input, [options])

The `input` and `options` are the same as [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch), with some exceptions:

- The `credentials` option is `same-origin` by default, which is the default in the spec too, but not all browsers have caught up yet.
- Adds some more options. See below.

Returns a [`Response` object](https://developer.mozilla.org/en-US/docs/Web/API/Response) with [`Body` methods](https://developer.mozilla.org/en-US/docs/Web/API/Body#Methods) added for convenience. So you can, for example, call `ky.get(input).json()` directly without having to await the `Response` first. When called like that, proper `Accept` header will be set depending on body method used. Unlike the `Body` methods of `window.Fetch`; these will throw an `HTTPError` if the response status is not in the range `200...299`.

### ky.get(input, [options])
### ky.post(input, [options])
### ky.put(input, [options])
### ky.patch(input, [options])
### ky.head(input, [options])
### ky.delete(input, [options])

Sets `options.method` to the method name and makes a request.

#### options

Type: `object`

##### method

Type: `string`<br>
Default: `get`

HTTP method used to make the request.

Internally, the standard methods (`GET`, `POST`, `PUT`, `PATCH`, `HEAD` and `DELETE`) are uppercased in order to avoid server errors due to case sensitivity.

##### json

Type: `object`

Shortcut for sending JSON. Use this instead of the `body` option. Accepts a plain object which will be `JSON.stringify()`'d and the correct header will be set for you.

##### searchParams

Type: `string | object<string, string | number> | URLSearchParams`<br>
Default: `''`

Search parameters to include in the request URL. Setting this will override all existing search parameters in the input URL.

##### prefixUrl

Type: `string | URL`

When specified, `prefixUrl` will be prepended to `input`. The prefix can be any valid URL, either relative or absolute. A trailing slash `/` is optional, one will be added automatically, if needed, when joining `prefixUrl` and `input`. The `input` argument cannot start with a `/` when using this option.

Useful when used with [`ky.extend()`](#kyextenddefaultoptions) to create niche-specific Ky-instances.

```js
import ky from 'ky';

// On https://example.com

(async () => {
	await ky('unicorn', {prefixUrl: '/api'});
	//=> 'https://example.com/api/unicorn'

	await ky('unicorn', {prefixUrl: 'https://cats.com'});
	//=> 'https://cats.com/unicorn'
})();
```

##### retry

Type: `number`<br>
Default: `2`

Retry failed requests made with one of the below methods that result in a network error or one of the below status codes.

Methods: `GET` `PUT` `HEAD` `DELETE` `OPTIONS` `TRACE`<br>
Status codes: [`408`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/408) [`413`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/413) [`429`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429) [`500`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/500) [`502`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/502) [`503`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/503) [`504`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/504)

It adheres to the [`Retry-After`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After) response header.

##### timeout

Type: `number | false`<br>
Default: `10000`

Timeout in milliseconds for getting a response. Can not be greater than 2147483647.
If set to `false`, there will be no timeout.

##### hooks

Type: `object<string, Function[]>`<br>
Default: `{beforeRequest: []}`

Hooks allow modifications during the request lifecycle. Hook functions may be async and are run serially.

###### hooks.beforeRequest

Type: `Function[]`<br>
Default: `[]`

This hook enables you to modify the request right before it is sent. Ky will make no further changes to the request after this. The hook function receives the normalized options as the first argument. You could, for example, modify `options.headers` here.

###### hooks.afterResponse

Type: `Function[]`<br>
Default: `[]`

This hook enables you to read and optionally modify the response. The hook function receives a clone of the response as the first argument. The return value of the hook function will be used by Ky as the response object if it's an instance of [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response).

```js
import ky from 'ky';

(async () => {
	await ky.get('https://example.com', {
		hooks: {
			afterResponse: [
				response => {
					// You could do something with the response, for example, logging.
					log(response);

					// Or return a `Response` instance to overwrite the response.
					return new Response('A different response', {status: 200});
				}
			]
		}
	});
})();
```

##### throwHttpErrors

Type: `boolean`<br>
Default: `true`

Throw a `HTTPError` for error responses (non-2xx status codes).

Setting this to `false` may be useful if you are checking for resource availability and are expecting error responses.

##### onDownloadProgress

Type: `Function`

Download progress event handler.

The function receives a `progress` and `chunk` argument:
- The `progress` object contains the following elements: `percent`, `transferredBytes` and `totalBytes`. If it's not possible to retrieve the body size, `totalBytes` will be `0`.
- The `chunk` argument is an instance of `Uint8Array`. It's empty for the first call.

```js
import ky from 'ky';

(async () => {
	await ky('https://example.com', {
		onDownloadProgress: (progress, chunk) => {
			// Example output:
			// `0% - 0 of 1271 bytes`
			// `100% - 1271 of 1271 bytes`
			console.log(`${progress.percent * 100}% - ${progress.transferredBytes} of ${progress.totalBytes} bytes`);
		}
	});
})();
```

### ky.extend(defaultOptions)

Create a new `ky` instance with some defaults overridden with your own.

In contrast to `ky.create()`, `ky.extend()` inherits defaults from its parent.

### ky.create(defaultOptions)

Create a new Ky instance with complete new defaults.

```js
import ky from 'ky';

// On https://my-site.com

const api = ky.create({prefixUrl: 'https://example.com/api'});

(async () => {
	await api.get('users/123');
	//=> 'https://example.com/api/users/123'

	await api.get('/status', {prefixUrl: ''});
	//=> 'https://my-site.com/status'
})();
```

#### defaultOptions

Type: `object`

### ky.HTTPError

Exposed for `instanceof` checks. The error has a `response` property with the [`Response` object](https://developer.mozilla.org/en-US/docs/Web/API/Response).

### ky.TimeoutError

The error thrown when the request times out.


## Tips

### Sending Form Data

Sending form data in Ky is identical to `fetch`. Just pass a [`FormData`](https://developer.mozilla.org/en-US/docs/Web/API/FormData) instance to the `body` option. The `Content-Type` header will be automatically set to `multipart/form-data`. Setting it manually will result in an error.

```js
import ky from 'ky';

(async () => {
	// `multipart/form-data`
	const formData = new FormData();
	formData.append('food', 'fries');
	formData.append('drink', 'icetea');

	await ky.post(url, {
		body: formData
	});
})();
```

If you want to send the data in `application/x-www-form-urlencoded` format, you will need to encode the data with [`URLSearchParams`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams).

```js
import ky from 'ky';

(async () => {
	// `application/x-www-form-urlencoded`
	const searchParams = new URLSearchParams();
	searchParams.set('food', 'fries');
	searchParams.set('drink', 'icetea');

	await ky.post(url, {
		body: searchParams
	});
})();
```

### Cancellation

Fetch (and hence Ky) has built-in support for request cancellation through the [`AbortController` API](https://developer.mozilla.org/en-US/docs/Web/API/AbortController). [Read more.](https://developers.google.com/web/updates/2017/09/abortable-fetch)

Example:

```js
import ky from 'ky';

const controller = new AbortController();
const {signal} = controller;

setTimeout(() => {
	controller.abort();
}, 5000);

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

#### How do I use this in Node.js?

Check out [`ky-universal`](https://github.com/sindresorhus/ky-universal#faq).

#### How do I use this with a web app (React, Vue.js, etc.) that uses server-side rendering (SSR)?

Check out [`ky-universal`](https://github.com/sindresorhus/ky-universal#faq).

#### How do I test a browser library that uses this?

Either use a test runner that can run in the browser, like Mocha, or use [AVA](http://ava.li) with `ky-universal`. [Read more.](https://github.com/sindresorhus/ky-universal#faq)

#### How do I use this without a bundler like Webpack?

Upload the [`index.js`](index.js) file in this repo somewhere, for example, to your website server, or use a CDN version. Then import the file.

```html
<script type="module">
// Replace the version number with the latest version
import ky from 'https://cdn.jsdelivr.net/npm/ky@0.11.0/index.js';

(async () => {
	const parsed = await ky('https://jsonplaceholder.typicode.com/todos/1').json();

	console.log(parsed.title);
	//=> 'delectus aut autem
})();
</script>
```

Alternatively, you can use the [`umd.js`](umd.js) file with a traditional `<script>` tag (without `type="module"`), in which case `ky` will be a global.

```html
<!-- Replace the version number with the latest version -->
<script src="https://cdn.jsdelivr.net/npm/ky@0.11.0/umd.js"></script>
<script>
(async () => {
	const ky = ky.default;

	const parsed = await ky('https://jsonplaceholder.typicode.com/todos/1').json();

	console.log(parsed.title);
	//=> 'delectus aut autem
})();
</script>
```

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


## Node.js support

Ky requires Node.js 10 or later, but it indicates Node.js 8 in package.json so you can use it with Node.js 8 by polyfilling the globals without having Yarn fail on install. However, you should just use [`ky-universal`](https://github.com/sindresorhus/ky-universal).


## Related

- [ky-universal](https://github.com/sindresorhus/ky-universal) - Use Ky in both Node.js and browsers
- [got](https://github.com/sindresorhus/got) - Simplified HTTP requests for Node.js


## Maintainers

- [Sindre Sorhus](https://github.com/sindresorhus)
- [Szymon Marczak](https://github.com/szmarczak)
- [Seth Holladay](https://github.com/sholladay)
