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
- Treats non-2xx status codes as errors (after redirects)
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
		throw new HTTPError(`Fetch error: ${response.statusText}`);
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
const ky = require('ky/umd');
```

With the UMD version, it's also easy to use `ky` [without a bundler](#how-do-i-use-this-without-a-bundler-like-webpack) or module system.

## API

### ky(input, options?)

The `input` and `options` are the same as [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch), with some exceptions:

- The `credentials` option is `same-origin` by default, which is the default in the spec too, but not all browsers have caught up yet.
- Adds some more options. See below.

Returns a [`Response` object](https://developer.mozilla.org/en-US/docs/Web/API/Response) with [`Body` methods](https://developer.mozilla.org/en-US/docs/Web/API/Body#Methods) added for convenience. So you can, for example, call `ky.get(input).json()` directly without having to await the `Response` first. When called like that, an appropriate `Accept` header will be set depending on the body method used. Unlike the `Body` methods of `window.Fetch`; these will throw an `HTTPError` if the response status is not in the range of `200...299`. Also, `.json()` will return an empty string if the response status is `204` instead of throwing a parse error due to an empty body.

### ky.get(input, options?)
### ky.post(input, options?)
### ky.put(input, options?)
### ky.patch(input, options?)
### ky.head(input, options?)
### ky.delete(input, options?)

Sets `options.method` to the method name and makes a request.

When using a `Request` instance as `input`, any URL altering options (such as `prefixUrl`) will be ignored.

#### options

Type: `object`

##### method

Type: `string`\
Default: `'get'`

HTTP method used to make the request.

Internally, the standard methods (`GET`, `POST`, `PUT`, `PATCH`, `HEAD` and `DELETE`) are uppercased in order to avoid server errors due to case sensitivity.

##### json

Type: `object` and any other value accepted by [`JSON.stringify()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)

Shortcut for sending JSON. Use this instead of the `body` option. Accepts any plain object or value, which will be `JSON.stringify()`'d and sent in the body with the correct header set.

##### searchParams

Type: `string | object<string, string | number | boolean> | Array<Array<string | number | boolean>> | URLSearchParams`\
Default: `''`

Search parameters to include in the request URL. Setting this will override all existing search parameters in the input URL.

Accepts any value supported by [`URLSearchParams()`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams/URLSearchParams).

##### prefixUrl

Type: `string | URL`

A prefix to prepend to the `input` URL when making the request. It can be any valid URL, either relative or absolute. A trailing slash `/` is optional and will be added automatically, if needed, when it is joined with `input`. Only takes effect when `input` is a string. The `input` argument cannot start with a slash `/` when using this option.

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

Notes:
 - After `prefixUrl` and `input` are joined, the result is resolved against the [base URL](https://developer.mozilla.org/en-US/docs/Web/API/Node/baseURI) of the page (if any).
 - Leading slashes in `input` are disallowed when using this option to enforce consistency and avoid confusion about how the `input` URL is handled, given that `input` will not follow the normal URL resolution rules when `prefixUrl` is being used, which changes the meaning of a leading slash.

##### retry

Type: `object | number`\
Default:
- `limit`: `2`
- `methods`: `get` `put` `head` `delete` `options` `trace`
- `statusCodes`: [`408`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/408) [`413`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/413) [`429`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429) [`500`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/500) [`502`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/502) [`503`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/503) [`504`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/504)
- `maxRetryAfter`: `undefined`

An object representing `limit`, `methods`, `statusCodes` and `maxRetryAfter` fields for maximum retry count, allowed methods, allowed status codes and maximum [`Retry-After`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After) time.

If `retry` is a number, it will be used as `limit` and other defaults will remain in place.

If `maxRetryAfter` is set to `undefined`, it will use `options.timeout`. If [`Retry-After`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After) header is greater than `maxRetryAfter`, it will cancel the request.

Delays between retries is calculated with the function `0.3 * (2 ** (retry - 1)) * 1000`, where `retry` is the attempt number (starts from 1).

```js
import ky from 'ky';

(async () => {
	const parsed = await ky('https://example.com', {
		retry: {
			limit: 10,
			methods: ['get'],
			statusCodes: [413]
		}
	}).json();
})();
```

##### timeout

Type: `number | false`\
Default: `10000`

Timeout in milliseconds for getting a response. Can not be greater than 2147483647.
If set to `false`, there will be no timeout.

##### hooks

Type: `object<string, Function[]>`\
Default: `{beforeRequest: [], beforeRetry: [], afterResponse: []}`

Hooks allow modifications during the request lifecycle. Hook functions may be async and are run serially.

###### hooks.beforeRequest

Type: `Function[]`\
Default: `[]`

This hook enables you to modify the request right before it is sent. Ky will make no further changes to the request after this. The hook function receives `request` and `options` as arguments. You could, for example, modify the `request.headers` here.

The hook can return a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) to replace the outgoing request, or return a [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) to completely avoid making an HTTP request. This can be used to mock a request, check an internal cache, etc. An **important** consideration when returning a request or response from this hook is that any remaining `beforeRequest` hooks will be skipped, so you may want to only return them from the last hook.

```js
import ky from 'ky';

const api = ky.extend({
	hooks: {
		beforeRequest: [
			request => {
				request.headers.set('X-Requested-With', 'ky');
			}
		]
	}
});

(async () => {
	const users = await api.get('https://example.com/api/users');
	// ...
})();
```

###### hooks.beforeRetry

Type: `Function[]`\
Default: `[]`

This hook enables you to modify the request right before retry. Ky will make no further changes to the request after this. The hook function receives an object with the normalized request and options, an error instance, and the retry count. You could, for example, modify `request.headers` here.

If the request received a response, it will be available at `error.response`. Be aware that some types of errors, such as network errors, inherently mean that a response was not received.

```js
import ky from 'ky';

(async () => {
	await ky('https://example.com', {
		hooks: {
			beforeRetry: [
				async ({request, options, error, retryCount}) => {
					const token = await ky('https://example.com/refresh-token');
					request.headers.set('Authorization', `token ${token}`);
				}
			]
		}
	});
})();
```

###### hooks.afterResponse

Type: `Function[]`\
Default: `[]`

This hook enables you to read and optionally modify the response. The hook function receives normalized request, options, and a clone of the response as arguments. The return value of the hook function will be used by Ky as the response object if it's an instance of [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response).

```js
import ky from 'ky';

(async () => {
	await ky('https://example.com', {
		hooks: {
			afterResponse: [
				(_request, _options, response) => {
					// You could do something with the response, for example, logging.
					log(response);

					// Or return a `Response` instance to overwrite the response.
					return new Response('A different response', {status: 200});
				},

				// Or retry with a fresh token on a 403 error
				async (request, options, response) => {
					if (response.status === 403) {
						// Get a fresh token
						const token = await ky('https://example.com/token').text();

						// Retry with the token
						request.headers.set('Authorization', `token ${token}`);

						return ky(request);
					}
				}
			]
		}
	});
})();
```

##### throwHttpErrors

Type: `boolean`\
Default: `true`

Throw an `HTTPError` when, after following redirects, the response has a non-2xx status code. To also throw for redirects instead of following them, set the [`redirect`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Parameters) option to `'manual'`.

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

##### parseJson

Type: `Function`\
Default: `JSON.parse()`

User-defined JSON-parsing function.

Use-cases:
1. Parse JSON via the [`bourne` package](https://github.com/hapijs/bourne) to protect from prototype pollution.
2. Parse JSON with [`reviver` option of `JSON.parse()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse).

```js
import ky from 'ky';
import bourne from '@hapijs/bourne';

(async () => {
	const parsed = await ky('https://example.com', {
		parseJson: text => bourne(text)
	}).json();
})();
```

##### fetch

Type: `Function`\
Default: `fetch`

User-defined `fetch` function.
Has to be fully compatible with the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) standard.

Use-cases:
1. Use custom `fetch` implementations like [`isomorphic-unfetch`](https://www.npmjs.com/package/isomorphic-unfetch).
2. Use the `fetch` wrapper function provided by some frameworks that use server-side rendering (SSR).

```js
import ky from 'ky';
import fetch from 'isomorphic-unfetch';

(async () => {
	const parsed = await ky('https://example.com', {
		fetch
	}).json();
})();
```

### ky.extend(defaultOptions)

Create a new `ky` instance with some defaults overridden with your own.

In contrast to `ky.create()`, `ky.extend()` inherits defaults from its parent.

You can pass headers as a `Headers` instance or a plain object.

You can remove a header with `.extend()` by passing the header with an `undefined` value.
Passing `undefined` as a string removes the header only if it comes from a `Headers` instance.

```js
import ky from 'ky';

const url = 'https://sindresorhus.com';

const original = ky.create({
	headers: {
		rainbow: 'rainbow',
		unicorn: 'unicorn'
	}
});

const extended = original.extend({
	headers: {
		rainbow: undefined
	}
});

const response = await extended(url).json();

console.log('rainbow' in response);
//=> false

console.log('unicorn' in response);
//=> true
```

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

### ky.stop

A `Symbol` that can be returned by a `beforeRetry` hook to stop the retry. This will also short circuit the remaining `beforeRetry` hooks.

```js
import ky from 'ky';

(async () => {
	await ky('https://example.com', {
		hooks: {
			beforeRetry: [
				async ({request, options, error, retryCount}) => {
					const shouldStopRetry = await ky('https://example.com/api');
					if (shouldStopRetry) {
						return ky.stop;
					}
				}
			]
		}
	});
})();
```

## Tips

### Sending form data

Sending form data in Ky is identical to `fetch`. Just pass a [`FormData`](https://developer.mozilla.org/en-US/docs/Web/API/FormData) instance to the `body` option. The `Content-Type` header will be automatically set to `multipart/form-data`.

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
import ky from 'https://cdn.jsdelivr.net/npm/ky@latest/index.js';

(async () => {
	const parsed = await ky('https://jsonplaceholder.typicode.com/todos/1').json();

	console.log(parsed.title);
	//=> 'delectus aut autem
})();
</script>
```

Alternatively, you can use the [`umd.js`](umd.js) file with a traditional `<script>` tag (without `type="module"`), in which case `ky` will be a global.

```html
<script src="https://cdn.jsdelivr.net/npm/ky@latest/umd.js"></script>
<script>
(async () => {
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

Polyfill the needed browser global or just use [`ky-universal`](https://github.com/sindresorhus/ky-universal).

## Related

- [ky-universal](https://github.com/sindresorhus/ky-universal) - Use Ky in both Node.js and browsers
- [got](https://github.com/sindresorhus/got) - Simplified HTTP requests for Node.js

## Maintainers

- [Sindre Sorhus](https://github.com/sindresorhus)
- [Szymon Marczak](https://github.com/szmarczak)
- [Seth Holladay](https://github.com/sholladay)
