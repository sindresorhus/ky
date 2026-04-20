<div align="center">
	<br>
	<div>
		<img width="600" height="600" src="media/logo.svg" alt="ky">
	</div>
	<br>
	<br>
	<p>
		<p>
			<sup>
				Sindre's open source work is supported by the community.<br>Special thanks to:
			</sup>
		</p>
		<br>
		<a href="https://circleback.ai?utm_source=sindresorhus&utm_medium=sponsorship&utm_campaign=awesome-list&utm_id=ky">
			<div>
				<img width="280" src="https://sindresorhus.com/assets/thanks/circleback-logo.png?x" alt="Circleback logo">
			</div>
			<b>Get the most out of every conversation.</b>
			<div>
				<sup>AI-powered meeting notes, automations, and search. Give AI agents the context they need to get things done.</sup>
			</div>
		</a>
	</p>
	<br>
	<br>
	<br>
	<br>
	<br>
	<br>
	<br>
</div>

> Ky is a tiny and elegant HTTP client based on the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch)

[![Coverage Status](https://codecov.io/gh/sindresorhus/ky/branch/main/graph/badge.svg)](https://codecov.io/gh/sindresorhus/ky)
[![](https://badgen.net/bundlephobia/minzip/ky)](https://bundlephobia.com/result?p=ky)

Ky targets [modern browsers](#browser-support), Node.js, Bun, and Deno.

It's just a tiny package with no dependencies.

## Benefits over plain `fetch`

- Simpler API
- Method shortcuts (`ky.post()`)
- Treats non-2xx status codes as errors (after redirects)
- Retries failed requests
- JSON option
- Timeout support
- Upload and download progress
- Base URL option
- Instances with custom defaults
- Hooks
- Response validation with [Standard Schema](https://standardschema.dev) (Zod, Valibot, etc.)
- TypeScript niceties (e.g., `.json()` supports generics and defaults to `unknown`, not `any`)

## Install

```sh
npm install ky
```

> [!NOTE]
> This readme is for the next version of Ky. For the current version, [click here](https://www.npmjs.com/package/ky).

###### CDN

- [jsdelivr](https://cdn.jsdelivr.net/npm/ky/+esm)
- [unpkg](https://unpkg.com/ky)
- [esm.sh](https://esm.sh/ky)

## Usage

```js
import ky from 'ky';

const json = await ky.post('https://example.com', {json: {foo: true}}).json();

console.log(json);
//=> {data: '🦄'}
```

With plain `fetch`, it would be:

```js
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

const json = await response.json();

console.log(json);
//=> {data: '🦄'}
```

If you are using [Deno](https://github.com/denoland/deno), import Ky from a URL. For example, using a CDN:

```js
import ky from 'https://esm.sh/ky';
```

## API

### ky(input, options?)

The `input` and `options` are the same as [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch), with additional `options` available (see below).

Returns a [`Response` object](https://developer.mozilla.org/en-US/docs/Web/API/Response) with [`Body` methods](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#body) added for convenience. So you can, for example, call `ky.get(input).json()` directly without having to await the `Response` first. When called like that, an appropriate `Accept` header will be set depending on the body method used. Unlike the `Body` methods of `window.fetch`, these will throw an `HTTPError` if the response status is not in the range of `200...299`. Also, `.json()` throws if the body is empty or the response status is `204`.

Available body shortcuts: `.json()`, `.text()`, `.formData()`, `.arrayBuffer()`, `.blob()`, and `.bytes()`. The `.bytes()` shortcut is only present when the runtime supports `Response.prototype.bytes()`.

```js
import ky from 'ky';

const user = await ky('/api/user').json();

console.log(user);
```

⌨️ **TypeScript:** Accepts an optional [type parameter](https://www.typescriptlang.org/docs/handbook/2/generics.html), which defaults to [`unknown`](https://www.typescriptlang.org/docs/handbook/2/functions.html#unknown), and is passed through to the return type of `.json()`.

```ts
import ky from 'ky';

// user1 is unknown
const user1 = await ky('/api/users/1').json();
// user2 is a User
const user2 = await ky<User>('/api/users/2').json();
// user3 is a User
const user3 = await ky('/api/users/3').json<User>();

console.log([user1, user2, user3]);
```

You can also get the response body as JSON and validate it with a Standard Schema compatible validator (for example, Zod 3.24+). This throws a `SchemaValidationError` when validation fails.

```ts
import ky, {SchemaValidationError} from 'ky';
import {z} from 'zod';

const userSchema = z.object({name: z.string()});

try {
	const user = await ky('/api/user').json(userSchema);
	console.log(user.name);
} catch (error) {
	if (error instanceof SchemaValidationError) {
		console.error(error.issues);
	}
}
```

```ts
// Get raw bytes (when supported by the runtime)
const bytes = await ky('/api/file').bytes();
console.log(bytes instanceof Uint8Array);
```

### ky.get(input, options?)
### ky.post(input, options?)
### ky.put(input, options?)
### ky.patch(input, options?)
### ky.head(input, options?)
### ky.delete(input, options?)

Sets `options.method` to the method name and makes a request.

⌨️ **TypeScript:** Accepts an optional type parameter for use with JSON responses (see [`ky()`](#kyinput-options)).

#### input

Type: `string` | `URL` | `Request`

Same as [`fetch` input](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#input).

When using a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) instance as `input`, any URL altering options (such as `baseUrl`) will be ignored.

#### options

Type: `object`

Same as [`fetch` options](https://developer.mozilla.org/en-US/docs/Web/API/fetch#options), plus the following additional options:

##### method

Type: `string`\
Default: `'get'`

HTTP method used to make the request.

Internally, the standard methods (`GET`, `POST`, `PUT`, `PATCH`, `HEAD` and `DELETE`) are uppercased in order to avoid server errors due to case sensitivity.

##### json

Type: `object` and any other value accepted by [`JSON.stringify()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)

Shortcut for sending JSON. Use this instead of the `body` option. Accepts any plain object or value, which will be stringified using `JSON.stringify()` and sent in the body with the correct header set.

##### searchParams

Type: `string | object<string, string | number | boolean | undefined> | Array<Array<string | number | boolean>> | URLSearchParams`\
Default: `''`

Search parameters to include in the request URL. Setting this will merge with any existing search parameters in the input URL.

Accepts any value supported by [`URLSearchParams()`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams/URLSearchParams).

When passing an object, setting a value to `undefined` deletes the parameter, while `null` values are preserved and converted to the string `'null'`.

##### baseUrl

Type: `string | URL`

A base URL to [resolve](https://developer.mozilla.org/en-US/docs/Web/API/URL_API/Resolving_relative_references) the `input` against. When the `input` (after applying the `prefix` option) is only a relative URL, such as `'users'`, `'/users'`, or `'//my-site.com'`, it will be resolved against the `baseUrl` to determine the destination of the request. Otherwise, the `input` is absolute, such as `'https://my-site.com'`, and it will bypass the `baseUrl`.

Useful when used with [`ky.extend()`](#kyextenddefaultoptions) to create niche-specific Ky instances.

If the `baseUrl` itself is relative, it will be resolved against the environment's base URL, such as [`document.baseURI`](https://developer.mozilla.org/en-US/docs/Web/API/Node/baseURI) in browsers or `location.href` in Deno (see the `--location` flag).

**Tip:** When setting a `baseUrl` that has a path, we recommend that it include a trailing slash `/`, as in `'/api/'` rather than `/api`. This ensures more intuitive behavior for page-relative `input` URLs, such as `'users'` or `'./users'`, where they will _extend_ from the full path of the `baseUrl` rather than _replacing_ its last path segment.

```js
import ky from 'ky';

// On https://example.com

const response = await ky('users', {baseUrl: '/api/'});
//=> 'https://example.com/api/users'

const response = await ky('/users', {baseUrl: '/api/'});
//=> 'https://example.com/users'
```

See [FAQ: `baseUrl` vs `prefix`](#baseurl-vs-prefix)

##### prefix

Type: `string | URL`

A prefix to prepend to the `input` before making the request (and before it is resolved against the `baseUrl`). It can be any valid path or URL, either relative or absolute. A trailing slash `/` is optional and will be added automatically, if needed, when it is joined with `input`. Only takes effect when `input` is a string.

Useful when used with [`ky.extend()`](#kyextenddefaultoptions) to create niche-specific Ky instances.

*In most cases, you should use the `baseUrl` option instead, as it is more consistent with web standards. However, `prefix` is useful if you want origin-relative `input` URLs, such as `/users`, to be treated as if they were page-relative. In other words, the leading slash of the `input` will essentially be ignored, because the `prefix` will become part of the `input` before URL resolution happens.*

See [FAQ: `baseUrl` vs `prefix`](#baseurl-vs-prefix)

```js
import ky from 'ky';

// On https://example.com

const response = await ky('users', {prefix: '/api/'});
//=> 'https://example.com/api/users'

const response = await ky('/users', {prefix: '/api/'});
//=> 'https://example.com/api/users'
```

Notes:
 - The `prefix` and `input` are joined with a slash `/`, and slashes are normalized at the join boundary by trimming trailing slashes from `prefix` and leading slashes from `input`.
 - After `prefix` and `input` are joined, the result is resolved against the `baseUrl` option, if present.

##### retry

Type: `object | number`\
Default:
- `limit`: `2`
- `methods`: `get` `put` `head` `delete` `options` `trace`
- `statusCodes`: [`408`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/408) [`413`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/413) [`429`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429) [`500`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/500) [`502`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/502) [`503`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/503) [`504`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/504)
- `afterStatusCodes`: [`413`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/413), [`429`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429), [`503`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/503)
- `maxRetryAfter`: `Infinity`
- `backoffLimit`: `Infinity`
- `delay`: `attemptCount => 0.3 * (2 ** (attemptCount - 1)) * 1000`
- `jitter`: `undefined`
- `retryOnTimeout`: `false`
- `shouldRetry`: `undefined`

Controls retry behavior. Each field is documented individually below.

If `retry` is a number, it will be used as `limit` and other defaults will remain in place.

Network errors (e.g., DNS failures, connection refused, offline) are automatically retried for retriable methods. Only errors recognized as network errors are retried; other errors (e.g., programming bugs) are thrown immediately. Use `shouldRetry` to customize this behavior.

If the response provides an HTTP status contained in `afterStatusCodes`, Ky will wait until the date, timeout, or timestamp given in the [`Retry-After`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After) header has passed to retry the request. If `Retry-After` is missing, the non-standard [`RateLimit-Reset`](https://www.ietf.org/archive/id/draft-polli-ratelimit-headers-05.html#section-3.3) header is used in its place as a fallback. If the provided status code is not in the list, the [`Retry-After`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After) header will be ignored.

If [`Retry-After`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After) header is greater than `maxRetryAfter`, it will use `maxRetryAfter`.

The `backoffLimit` option is the upper limit of the delay per retry in milliseconds.
To clamp the delay, set `backoffLimit` to 1000, for example.
By default, the delay is calculated with `0.3 * (2 ** (attemptCount - 1)) * 1000`. The delay increases exponentially.

The `delay` option can be used to change how the delay between retries is calculated. The function receives one parameter, the attempt count, starting at `1`, and must return the delay in milliseconds.

The `jitter` option adds random jitter to retry delays to prevent thundering herd problems. When many clients retry simultaneously (e.g., after hitting a rate limit), they can overwhelm the server again. Jitter adds randomness to break this synchronization. Set to `true` to use full jitter, which randomizes the delay between 0 and the computed delay. Alternatively, pass a function to implement custom jitter strategies.

**Note:** Jitter is not applied when the server provides a `Retry-After` header, as the server's explicit timing should be respected.

The `retryOnTimeout` option determines whether to retry when a request times out. By default, retries are not triggered following a [timeout](#timeout).

The `shouldRetry` option provides custom retry logic that **takes precedence over the default retry checks** (`retryOnTimeout`, status code checks, etc.) for retriable methods. It is only called after the retry limit and method checks pass.

**Note:** This is different from the `beforeRetry` hook:
- `shouldRetry`: Controls WHETHER to retry (called before the retry decision is made)
- `beforeRetry`: Called AFTER retry is confirmed, allowing you to modify the request

The function receives a state object with the error and retry count (starts at 1 for the first retry), and should return:
- `true` to force a retry (bypasses `retryOnTimeout`, status code checks, and other default validations)
- `false` to prevent a retry (no retry will occur)
- `undefined` to use the default retry logic (`retryOnTimeout`, status codes, network errors). Unrecognized error types are not retried.

**General example**

```js
import ky from 'ky';

const json = await ky('https://example.com', {
	retry: {
		limit: 10,
		methods: ['get'],
		statusCodes: [413],
		backoffLimit: 3000
	}
}).json();
```

**Retrying on timeout:**

```js
import ky from 'ky';

const json = await ky('https://example.com', {
	timeout: 5000,
	retry: {
		limit: 3,
		retryOnTimeout: true
	}
}).json();
```

**Using jitter to prevent thundering herd:**

```js
import ky from 'ky';

const json = await ky('https://example.com', {
	retry: {
		limit: 5,

		// Full jitter (randomizes delay between 0 and computed value)
		jitter: true

		// Percentage jitter (80-120% of delay)
		// jitter: delay => delay * (0.8 + Math.random() * 0.4)

		// Absolute jitter (±100ms)
		// jitter: delay => delay + (Math.random() * 200 - 100)
	}
}).json();
```

**Custom retry logic:**

```js
import ky, {HTTPError} from 'ky';

const json = await ky('https://example.com', {
	retry: {
		limit: 3,
		shouldRetry: ({error, retryCount}) => {
			// Retry on specific business logic errors from API
			if (error instanceof HTTPError) {
				const status = error.response.status;

				// Retry on 429 (rate limit) but only for first 2 attempts
				if (status === 429 && retryCount <= 2) {
					return true;
				}

				// Don't retry on 4xx errors except rate limits
				if (status >= 400 && status < 500) {
					return false;
				}
			}

			// Use default retry logic for other errors
			return undefined;
		}
	}
}).json();
```

> [!NOTE]
> When retries are enabled, Ky clones the request body before each attempt using [`tee()`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/tee), which buffers the entire `ReadableStream` in memory. Set `retry: {limit: 0}` if you're uploading large streaming bodies and don't need retries.

> [!NOTE]
> Chromium-based browsers automatically retry `408 Request Timeout` responses at the network layer for keep-alive connections. This means requests may be retried by both the browser and ky. If you want to avoid duplicate retries, you can either set `keepalive: false` in your request options (though this may impact performance for multiple requests) or remove `408` from the retry status codes.

##### timeout

Type: `number | false`\
Default: `10000`

Per-attempt timeout in milliseconds for getting a response, applied independently to each retry. Cannot be greater than 2147483647. See also [`totalTimeout`](#totaltimeout).

If set to `false`, there will be no per-attempt timeout.

##### totalTimeout

Type: `number | false`\
Default: `false`

Overall timeout in milliseconds for the entire operation, including retries and delays. Throws a `TimeoutError` if exceeded. Cannot be greater than 2147483647.

If set to `false` or not specified, there is no overall timeout.

```js
import ky from 'ky';

// Each attempt gets 5s, but the whole operation must complete within 30s
const json = await ky('https://example.com', {
	timeout: 5000,
	totalTimeout: 30_000,
	retry: {
		limit: 3,
		retryOnTimeout: true,
	}
}).json();
```

##### hooks

Type: `object<string, Function[]>`\
Default: `{init: [], beforeRequest: [], beforeRetry: [], beforeError: [], afterResponse: []}`

Hooks allow modifications during the request lifecycle. Hook functions may be async and are run serially, unless otherwise noted.

###### hooks.init

Type: `Function[]`\
Default: `[]`

This hook enables you to modify the options before they are used to construct the request. The hook function receives the mutable options object and can modify it in place. You could, for example, modify `searchParams`, `headers`, or `json` here.

Unlike other hooks, `init` hooks are synchronous. Any error thrown will propagate synchronously and will not be caught by `beforeError` hooks.

A common use case is to add a search parameter to every request:

```js
import ky from 'ky';

const api = ky.extend({
	hooks: {
		init: [
			options => {
				options.searchParams = {apiKey: getApiKey()};
			},
		],
	},
});

const response = await api.get('https://example.com/api/users');
// URL: https://example.com/api/users?apiKey=123
```

###### hooks.beforeRequest

Type: `Function[]`\
Default: `[]`

This hook enables you to modify the request right before it is sent. Ky will make no further changes to the request after this. The hook function receives a state object with the normalized request, options, and retry count. You could, for example, modify `request.headers` here.

The `retryCount` is always `0`, since `beforeRequest` hooks run once before retry handling begins.

The hook can return a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) to replace the outgoing request (remaining hooks will still run with the updated request). It can also return a [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) to completely avoid making an HTTP request, in which case remaining `beforeRequest` hooks are skipped. This can be used to mock a request, check an internal cache, etc.

Any error thrown by `beforeRequest` hooks is treated as fatal and will not trigger Ky's retry logic.

```js
import ky from 'ky';

const api = ky.extend({
	hooks: {
		beforeRequest: [
			({request}) => {
				request.headers.set('Authorization', 'token initial-token');
			}
		]
	}
});

const response = await api.get('https://example.com/api/users');
```

**Modifying the request URL:**

```js
import ky from 'ky';

const api = ky.extend({
	hooks: {
		beforeRequest: [
			({request}) => {
				const url = new URL(request.url);
				url.searchParams.set('token', 'secret-token');
				return new Request(url, request);
			}
		]
	}
});

const response = await api.get('https://example.com/api/users');
```

###### hooks.beforeRetry

Type: `Function[]`\
Default: `[]`

This hook enables you to modify the request right before retry. Ky will make no further changes to the request after this. The hook function receives a state object with the normalized request, options, an error instance, and retry count. You could, for example, modify `request.headers` here.

The hook can return a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) to replace the outgoing retry request, or return a [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) to skip the retry and use that response instead. **Note:** Returning a request or response skips remaining `beforeRetry` hooks.

> [!WARNING]
> Returned `Request` objects are used as-is. If you point one at another origin, remove any credentials you do not want forwarded.

The `retryCount` is always `>= 1`, since this hook is only called during retries, not on the initial request.

If the request received a response, the error will be of type `HTTPError`. The `Response` object will be available at `error.response`, and the pre-parsed response body will be available at `error.data`. Be aware that some types of errors, such as network errors, inherently mean that a response was not received. In that case, the error will be an instance of `NetworkError` instead of `HTTPError`.

You can prevent Ky from retrying the request by throwing an error. Ky will not handle it in any way and the error will be propagated to the request initiator. The rest of the `beforeRetry` hooks will not be called in this case. Alternatively, you can return the [`ky.stop`](#kystop) symbol to do the same thing but without propagating an error (this has some limitations, see `ky.stop` docs for details).

**Modifying headers:**

```js
import ky from 'ky';

const response = await ky('https://example.com', {
	hooks: {
		beforeRetry: [
			async ({request, options, error, retryCount}) => {
				const token = await ky('https://example.com/refresh-token');
				request.headers.set('Authorization', `token ${token}`);
			}
		]
	}
});
```

**Modifying the request URL:**

```js
import ky, {isHTTPError} from 'ky';

const response = await ky('https://example.com/api', {
	hooks: {
		beforeRetry: [
			({request, error}) => {
				// Add query parameters based on error response
				if (
					isHTTPError(error)
					&& typeof error.data === 'object'
					&& error.data !== null
					&& 'processId' in error.data
				) {
					const url = new URL(request.url);
					url.searchParams.set('processId', String(error.data.processId));
					return new Request(url, request);
				}
			}
		]
	}
});
```

**Returning a cached response:**

```js
import ky from 'ky';

const response = await ky('https://example.com/api', {
	hooks: {
		beforeRetry: [
			({error, retryCount}) => {
				// Use cached response instead of retrying
				if (retryCount > 1 && cachedResponse) {
					return cachedResponse;
				}
			}
		]
	}
});
```

###### hooks.beforeError

Type: `Function[]`\
Default: `[]`

This hook enables you to modify any error right before it is thrown. The hook function receives a state object with the current request, the normalized Ky options, the error, and retry count, and should return an `Error` instance.

This hook is called for all error types, including `HTTPError`, `NetworkError`, `TimeoutError`, and `ForceRetryError` (when retry limit is exceeded via `ky.retry()`). Use type guards like `isHTTPError()`, `isNetworkError()`, or `isTimeoutError()` to handle specific error types.

The `retryCount` is `0` for the initial request and increments with each retry. This allows you to distinguish between the initial request and retries, which is useful when you need different error handling based on retry attempts (e.g., showing different error messages on the final attempt).

If a `beforeRequest` or `beforeRetry` hook returns a new `Request`, inspect `request` for the final request state. `options` remains Ky's normalized options and may not mirror every property of a replacement `Request`.

```js
import ky, {isHTTPError} from 'ky';

await ky('https://example.com', {
	hooks: {
		beforeError: [
			({request, options, error}) => {
				if (isHTTPError(error)) {
					if (
						typeof error.data === 'object'
						&& error.data !== null
						&& 'message' in error.data
					) {
						error.name = 'GitHubError';
						error.message = `${String(error.data.message)} (${error.response.status})`;
					}
				}

				// `request` and `options` are always available
				console.log(`Request to ${request.url} failed`, options.context);

				return error;
			}
		]
	}
});
```

###### hooks.afterResponse

Type: `Function[]`\
Default: `[]`

This hook enables you to read and optionally modify the response. The hook function receives a state object with the normalized request, options, a clone of the response, and retry count. The return value of the hook function will be used by Ky as the response object if it's an instance of [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response).

You can also force a retry by returning [`ky.retry(options)`](#kyretryoptions). This is useful when you need to retry based on the response body content, even if the response has a successful status code. The retry will respect the `retry.limit` option and be observable in `beforeRetry` hooks.

> [!WARNING]
> `ky.retry({request})` uses the replacement request as-is. If it targets another origin, remove any credentials you do not want forwarded.

Any non-`ky.retry()` error thrown by `afterResponse` hooks is treated as fatal and will not trigger Ky's retry logic.

The `retryCount` is `0` for the initial request and increments with each retry. This allows you to distinguish between the initial request and retries, which is useful when you need different behavior for retries (e.g., showing a notification only on the final retry).

```js
import ky from 'ky';

const response = await ky('https://example.com', {
	hooks: {
		afterResponse: [
			({response}) => {
				// You could do something with the response, for example, logging.
				log(response);

				// Or return a `Response` instance to overwrite the response.
				return new Response('A different response', {status: 200});
			},

			// Or retry with a fresh token on a 401 error
			async ({request, response, retryCount}) => {
				if (response.status === 401 && retryCount === 0) {
					// Only refresh on first 401, not on subsequent retries
					const {token} = await ky.post('https://example.com/auth/refresh').json();

					const headers = new Headers(request.headers);
					headers.set('Authorization', `Bearer ${token}`);

					return ky.retry({
						request: new Request(request, {headers}),
						code: 'TOKEN_REFRESHED'
					});
				}
			},

			// Or force retry based on response body content
			async ({response}) => {
				if (response.status === 200) {
					const data = await response.json();
					if (data.error?.code === 'RATE_LIMIT') {
						// Retry with custom delay from API response
						return ky.retry({
							delay: data.error.retryAfter * 1000,
							code: 'RATE_LIMIT'
						});
					}
				}
			},

			// Or show a notification only on the last retry for 5xx errors
			({options, response, retryCount}) => {
				if (response.status >= 500 && response.status <= 599) {
					if (retryCount === options.retry.limit) {
						showNotification('Request failed after all retries');
					}
				}
			}
		]
	}
});
```

##### throwHttpErrors

Type: `boolean | (status: number) => boolean`\
Default: `true`

Throw an `HTTPError` when, after following redirects, the response has a non-2xx status code. To also throw for redirects instead of following them, set the [`redirect`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Parameters) option to `'manual'`.

Setting this to `false` may be useful if you are checking for resource availability and are expecting error responses.

You can also pass a function that accepts the HTTP status code and returns a boolean for selective error handling. Note that this can violate the principle of least surprise, so it's recommended to use the boolean form unless you have a specific use case like treating 404 responses differently.

Note: If `false`, error responses are considered successful and the request will not be retried.

Note: [Opaque responses](https://developer.mozilla.org/en-US/docs/Web/API/Response/type) from `no-cors` requests are returned as-is (without throwing `HTTPError`), since the actual status is hidden by the browser.

##### onDownloadProgress

Type: `Function`

Download progress event handler.

The function receives these arguments:
- `progress` is an object with these properties:
  - `percent` is a number between 0 and 1 representing the progress percentage.
  - `transferredBytes` is the number of bytes transferred so far.
  - `totalBytes` is the total number of bytes to be transferred. This is an estimate and may be 0 if the total size cannot be determined.
- `chunk` is an instance of `Uint8Array` containing the data that was received. Note: It's empty for the first call.

```js
import ky from 'ky';

const response = await ky('https://example.com', {
	onDownloadProgress: (progress, chunk) => {
		// Example output:
		// `0% - 0 of 1271 bytes`
		// `100% - 1271 of 1271 bytes`
		console.log(`${progress.percent * 100}% - ${progress.transferredBytes} of ${progress.totalBytes} bytes`);
	}
});
```

##### onUploadProgress

Type: `Function`

Upload progress event handler.

> [!NOTE]
> Requires [request stream support](https://caniuse.com/wf-fetch-request-streams) and HTTP/2 for HTTPS connections (in Chromium-based browsers). In unsupported environments, this handler is silently ignored.

The function receives these arguments:
- `progress` is an object with these properties:
  - `percent` is a number between 0 and 1 representing the progress percentage.
  - `transferredBytes` is the number of bytes transferred so far.
  - `totalBytes` is the total number of bytes to be transferred. This is an estimate and may be 0 if the total size cannot be determined.
- `chunk` is an instance of `Uint8Array` containing the data that was sent. Note: It's empty for the last call.

```js
import ky from 'ky';

const response = await ky.post('https://example.com/upload', {
	body: largeFile,
	onUploadProgress: (progress, chunk) => {
		// Example output:
		// `0% - 0 of 1271 bytes`
		// `100% - 1271 of 1271 bytes`
		console.log(`${progress.percent * 100}% - ${progress.transferredBytes} of ${progress.totalBytes} bytes`);
	}
});
```

##### parseJson

Type: `Function`\
Default: `JSON.parse()`

User-defined JSON-parsing function.

The function receives the response text as the first argument and a context object as the second argument containing the `request` ([`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request)) and `response` ([`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response)).

Use-cases:
1. Parse JSON via the [`bourne` package](https://github.com/hapijs/bourne) to protect from prototype pollution.
2. Parse JSON with [`reviver` option of `JSON.parse()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse).
3. Log or handle JSON parse errors with request context.

```js
import ky from 'ky';
import bourne from '@hapijs/bourne';

const json = await ky('https://example.com', {
	parseJson: text => bourne(text)
}).json();
```

```js
import ky from 'ky';

const json = await ky('https://example.com', {
	parseJson: (text, {request, response}) => {
		console.log(`Parsing JSON from ${request.url} (status: ${response.status})`);
		return JSON.parse(text);
	}
}).json();
```

##### stringifyJson

Type: `Function`\
Default: `JSON.stringify()`

User-defined JSON-stringifying function.

Use-cases:
1. Stringify JSON with a custom `replacer` function.

```js
import ky from 'ky';
import {DateTime} from 'luxon';

const json = await ky('https://example.com', {
	stringifyJson: data => JSON.stringify(data, (key, value) => {
		if (key.endsWith('_at')) {
			return DateTime.fromISO(value).toSeconds();
		}

		return value;
	})
}).json();
```

##### fetch

Type: `Function`\
Default: `fetch`

User-defined `fetch` function.
Has to be fully compatible with the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) standard.

Use-cases:
1. Use the `fetch` wrapper function provided by some frameworks that use server-side rendering (SSR).
2. Add custom instrumentation or logging to all requests.

```js
import ky from 'ky';

const api = ky.create({
	fetch: async (request, init) => {
		const start = performance.now();
		const response = await fetch(request, init);
		const duration = performance.now() - start;
		console.log(`${request.method} ${request.url} - ${response.status} (${Math.round(duration)}ms)`);
		return response;
	}
});

const json = await api('https://example.com').json();
```

##### context

Type: `object<string, unknown>`\
Default: `{}`

User-defined data passed to hooks.

This option allows you to pass arbitrary contextual data to hooks without polluting the request itself. The context is available in all hooks and is **guaranteed to always be an object** (never `undefined`), so you can safely access properties without optional chaining.

Use cases:
- Pass authentication tokens or API keys to hooks
- Attach request metadata for logging or debugging
- Implement conditional logic in hooks based on the request context
- Pass serverless environment bindings (e.g., Cloudflare Workers)

**Note:** Context is shallow merged. Top-level properties are merged, but nested objects are replaced. Only enumerable properties are copied.

```js
import ky from 'ky';

// Pass data to hooks
const api = ky.create({
	hooks: {
		beforeRequest: [
			({request, options}) => {
				const {token} = options.context;
				if (token) {
					request.headers.set('Authorization', `Bearer ${token}`);
				}
			}
		]
	}
});

await api('https://example.com', {
	context: {
		token: 'secret123'
	}
}).json();

// Shallow merge: only top-level properties are merged
const instance = ky.create({
	context: {
		a: 1,
		b: {
			nested: true
		}
	}
});

const extended = instance.extend({
	context: {
		b: {
			updated: true
		},
		c: 3
	}
});
// Result: {a: 1, b: {updated: true}, c: 3}
// Note: The original `b.nested` is gone (shallow merge)
```

### ky.extend(defaultOptions)

Create a new `ky` instance with some defaults overridden with your own.

In contrast to `ky.create()`, `ky.extend()` inherits defaults from its parent.

You can pass headers as a `Headers` instance or a plain object.

You can remove a header with `.extend()` by passing the header with an `undefined` value.
Passing `undefined` as a string removes the header only if it comes from a `Headers` instance.

Similarly, you can remove existing `hooks` entries by extending the hook with an explicit `undefined`.

```js
import ky from 'ky';

const url = 'https://sindresorhus.com';

const original = ky.create({
	headers: {
		rainbow: 'rainbow',
		unicorn: 'unicorn'
	},
	hooks: {
		beforeRequest: [ () => console.log('before 1') ],
		afterResponse: [ () => console.log('after 1') ],
	},
});

const extended = original.extend({
	headers: {
		rainbow: undefined
	},
	hooks: {
		beforeRequest: undefined,
		afterResponse: [ () => console.log('after 2') ],
	}
});

const response = await extended(url).json();
//=> after 1
//=> after 2

console.log('rainbow' in response);
//=> false

console.log('unicorn' in response);
//=> true
```

You can also refer to parent defaults by providing a function to `.extend()`.

```js
import ky from 'ky';

const api = ky.create({prefix: 'https://example.com/api'});

const usersApi = api.extend((options) => ({prefix: `${options.prefix}/users`}));

const response = await usersApi.get('123');
//=> 'https://example.com/api/users/123'

const response = await api.get('version');
//=> 'https://example.com/api/version'
```

By default, `.extend()` deep-merges options: hooks are appended, headers are merged, and search parameters are accumulated. Use [`replaceOption`](#replaceoption) when you want to fully replace a merged property instead.

```js
import ky, {replaceOption} from 'ky';

const api = ky.create({
	hooks: {
		beforeRequest: [addAuth, addTracking],
	},
});

// Appends as expected
const extended = api.extend({hooks: {beforeRequest: [logRequest]}});
// extended hooks.beforeRequest is [addAuth, addTracking, logRequest]

// Replaces instead of appending
const replaced = api.extend({hooks: replaceOption({beforeRequest: [onlyThis]})});
// replaced hooks.beforeRequest is [onlyThis]
```

### ky.create(defaultOptions)

Create a new Ky instance with complete new defaults, without inheriting from any parent instance.

```js
import ky from 'ky';

// On https://my-site.com

const api = ky.create({baseUrl: 'https://example.com/api/'});

const response = await api.get('users/123');
//=> 'https://example.com/api/users/123'

const response = await api.get('status', {baseUrl: ''});
//=> 'https://my-site.com/status'
```

#### defaultOptions

Type: `object`

### ky.stop

A `Symbol` that can be returned by a `beforeRetry` hook to stop the retry. This will also short circuit the remaining `beforeRetry` hooks.

Note: Returning this symbol makes Ky abort and return with an `undefined` response. Be sure to check for a response before accessing any properties on it or use [optional chaining](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining). It is also incompatible with body methods, such as `.json()` or `.text()`, because there is no response to parse. In general, we recommend throwing an error instead of returning this symbol, as that will cause Ky to abort and then throw, which avoids these limitations.

A valid use-case for `ky.stop` is to prevent retries when making requests for side effects, where the returned data is not important. For example, logging client activity to the server.

```js
import ky from 'ky';

const options = {
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
};

// Note that `response` will be `undefined` in case `ky.stop` is returned.
const response = await ky.post('https://example.com', options);

// Using `.text()` or other body methods is not supported.
const text = await ky('https://example.com', options).text();
```

### ky.retry(options?)

Force a retry from an `afterResponse` hook.

This allows you to retry a request based on the response content, even if the response has a successful status code. The retry will respect the `retry.limit` option and skip the `shouldRetry` check. The forced retry is observable in `beforeRetry` hooks, where the error will be a `ForceRetryError`.

#### options

Type: `object`

##### delay

Type: `number`

Custom delay in milliseconds before retrying. If not provided, uses the default retry delay calculation based on `retry.delay` configuration.

**Note:** Custom delays bypass jitter and `backoffLimit`. This is intentional, as custom delays often come from server responses (e.g., `Retry-After` headers) and should be respected exactly as specified.

##### code

Type: `string`

Error code for the retry.

This machine-readable identifier will be included in the error message passed to `beforeRetry` hooks, allowing you to distinguish between different types of forced retries.

```js
return ky.retry({code: 'RATE_LIMIT'});
// Resulting error message: 'Forced retry: RATE_LIMIT'
```

##### cause

Type: `Error`

Original error that caused the retry. This allows you to preserve the error chain when forcing a retry based on caught exceptions. The error will be set as the `cause` of the `ForceRetryError`, enabling proper error chain traversal.

```js
try {
	const data = await response.json();
	validateBusinessLogic(data);
} catch (error) {
	return ky.retry({
		code: 'VALIDATION_FAILED',
		cause: error  // Preserves original error in chain
	});
}
```

##### request

Type: `Request`

Custom request to use for the retry.

This allows you to modify or completely replace the request during a forced retry. The custom request becomes the starting point for the retry - `beforeRetry` hooks can still further modify it if needed.

**Note:** The custom request's `signal` will be replaced with Ky's managed signal to handle timeouts and user-provided abort signals correctly. If the original request body has been consumed, you must provide a new body or clone the request before consuming.

> [!WARNING]
> Custom retry requests are not sanitized. If you reuse headers across origins, remove any credentials you do not want forwarded.

#### Example

```js
import ky, {isForceRetryError} from 'ky';

const api = ky.extend({
	hooks: {
		afterResponse: [
			async ({request, response}) => {
				// Retry based on response body content
				if (response.status === 200) {
					const data = await response.json();

					// Simple retry with default delay
					if (data.error?.code === 'TEMPORARY_ERROR') {
						return ky.retry();
					}

					// Retry with custom delay from API response
					if (data.error?.code === 'RATE_LIMIT') {
						return ky.retry({
							delay: data.error.retryAfter * 1000,
							code: 'RATE_LIMIT'
						});
					}

					// Retry with a modified request (e.g., fallback endpoint)
					if (data.error?.code === 'FALLBACK_TO_BACKUP') {
						return ky.retry({
							request: new Request('https://backup-api.com/endpoint', {
								method: request.method,
								headers: request.headers,
							}),
							code: 'BACKUP_ENDPOINT'
						});
					}

					// Retry with refreshed authentication
					if (data.error?.code === 'TOKEN_REFRESH' && data.newToken) {
						return ky.retry({
							request: new Request(request, {
								headers: {
									...Object.fromEntries(request.headers),
									'Authorization': `Bearer ${data.newToken}`
								}
							}),
							code: 'TOKEN_REFRESHED'
						});
					}

					// Retry with cause to preserve error chain
					try {
						validateResponse(data);
					} catch (error) {
						return ky.retry({
							code: 'VALIDATION_FAILED',
							cause: error
						});
					}
				}
			}
		],
		beforeRetry: [
			({error, retryCount}) => {
				// Observable in beforeRetry hooks
				if (isForceRetryError(error)) {
					console.log(`Forced retry #${retryCount}: ${error.message}`);
					// Example output: "Forced retry #1: Forced retry: RATE_LIMIT"
				}
			}
		]
	}
});

const response = await api.get('https://example.com/api');
```

### KyError

Base class for all Ky-specific errors. `HTTPError`, `NetworkError`, `TimeoutError`, and `ForceRetryError` extend this class.

You can use `instanceof KyError` to check if an error originated from Ky, or use the `isKyError()` type guard for cross-realm compatibility and TypeScript type narrowing.

> [!NOTE]
> `SchemaValidationError` is intentionally not considered a Ky error. `KyError` covers failures in Ky's HTTP lifecycle (bad status, timeout, retry), while schema validation errors originate from the user-provided schema, not from Ky itself.

```js
import ky, {isKyError} from 'ky';

try {
	await ky('https://example.com').json();
} catch (error) {
	if (isKyError(error)) {
		console.log('Ky error:', error.message);
	}
}
```

### HTTPError

Exposed for `instanceof` checks. The error has a `response` property with the [`Response` object](https://developer.mozilla.org/en-US/docs/Web/API/Response), `request` property with the [`Request` object](https://developer.mozilla.org/en-US/docs/Web/API/Request), and `options` property with normalized options (either passed to `ky` when creating an instance with `ky.create()` or directly when performing the request).

It also has a `data` property with the pre-parsed response body. For JSON responses (based on `Content-Type`), the body is parsed using the [`parseJson` option](#parsejson) if set, or `JSON.parse` by default. For other content types, it is set as plain text. If the body is empty or parsing fails, `data` will be `undefined`. To avoid hanging or excessive buffering, `error.data` population is bounded by the request timeout and a 10 MiB response body size limit. The `data` property is populated before [`beforeError`](#hooks) hooks run, so hooks can access it.

Be aware that some types of errors, such as network errors, inherently mean that a response was not received. In that case, the error will be an instance of [`NetworkError`](#networkerror) instead of `HTTPError` and will not contain a `response` property.

> [!NOTE]
> The response body is automatically consumed when populating `error.data`, so `error.response.json()` and other body methods will not work. Use `error.data` instead. The `error.response` object is still available for headers, status, etc.

```js
import ky, {isHTTPError} from 'ky';

try {
	await ky('https://example.com').json();
} catch (error) {
	if (isHTTPError(error)) {
		console.log(error.data);
	}
}
```

You can also use the `beforeError` hook:

```js
import ky, {isHTTPError} from 'ky';

await ky('https://example.com', {
	hooks: {
		beforeError: [
			({error}) => {
				if (isHTTPError(error) && error.data !== undefined) {
					error.message = `${error.message}: ${JSON.stringify(error.data)}`;
				}

				return error;
			}
		]
	}
});
```

⌨️ **TypeScript:** Accepts an optional [type parameter](https://www.typescriptlang.org/docs/handbook/2/generics.html), which defaults to [`unknown`](https://www.typescriptlang.org/docs/handbook/2/functions.html#unknown), and is passed through to the type of `error.data`.

### SchemaValidationError

The error thrown when [Standard Schema](https://github.com/standard-schema/standard-schema) validation fails in `.json(schema)`. It has an `issues` property with the validation issues from the schema.

This error intentionally does not extend `KyError` because it does not represent a failure in Ky's HTTP lifecycle. The request succeeded; the user's schema rejected the data. As such, it is not matched by `isKyError()`.

```js
import ky, {SchemaValidationError} from 'ky';
import {z} from 'zod';

const userSchema = z.object({name: z.string()});

try {
	const user = await ky('/api/user').json(userSchema);
	console.log(user.name);
} catch (error) {
	if (error instanceof SchemaValidationError) {
		console.error(error.issues);
	}
}
```

### TimeoutError

The error thrown when the request times out. It has a `request` property with the [`Request` object](https://developer.mozilla.org/en-US/docs/Web/API/Request).

```js
import ky, {isTimeoutError} from 'ky';

try {
	await ky('https://example.com').json();
} catch (error) {
	if (isTimeoutError(error)) {
		console.log('Request timed out');
	}
}
```

### NetworkError

The error thrown when a network error occurs during the request (e.g., DNS failure, connection refused, offline). It has a `request` property with the [`Request` object](https://developer.mozilla.org/en-US/docs/Web/API/Request). The original error is available via the standard `cause` property.

Network errors are automatically retried (for [retriable methods](#retry)).

> [!NOTE]
> Network errors are detected using runtime-specific heuristics. Unrecognized runtimes may produce errors that are not wrapped in `NetworkError`. Use the [`shouldRetry`](#retry) option to handle such cases.

```js
import ky, {isNetworkError} from 'ky';

try {
	await ky('https://example.com').json();
} catch (error) {
	if (isNetworkError(error)) {
		console.log('Network error:', error.message);
		console.log('Original error:', error.cause);
	}
}
```

### replaceOption

Wraps a value so that [`ky.extend()`](#kyextenddefaultoptions) will replace the parent value instead of merging with it. Works with hooks, headers, search parameters, context, and any other deep-merged option.

```js
import ky, {replaceOption} from 'ky';

const api = ky.create({
	headers: {authorization: 'Bearer token', 'x-custom': 'value'},
});

// Replace all headers instead of merging
const publicApi = api.extend({
	headers: replaceOption({accept: 'application/json'}),
});
// Headers are now just {accept: 'application/json'}
```

## Tips

### Sending form data

Sending form data in Ky is identical to `fetch`. Just pass a [`FormData`](https://developer.mozilla.org/en-US/docs/Web/API/FormData) instance to the `body` option. The `Content-Type` header will be automatically set to `multipart/form-data`, overriding any existing `Content-Type` header.

```js
import ky from 'ky';

// `multipart/form-data`
const formData = new FormData();
formData.append('food', 'fries');
formData.append('drink', 'icetea');

const response = await ky.post(url, {body: formData});
```

If you want to send the data in `application/x-www-form-urlencoded` format, you will need to encode the data with [`URLSearchParams`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams). Like `FormData`, this will override any existing `Content-Type` headers.

```js
import ky from 'ky';

// `application/x-www-form-urlencoded`
const searchParams = new URLSearchParams();
searchParams.set('food', 'fries');
searchParams.set('drink', 'icetea');

const response = await ky.post(url, {body: searchParams});
```

#### Modifying FormData in hooks

If you need to modify FormData in a `beforeRequest` hook (for example, to transform field names), delete the `Content-Type` header before creating a new `Request`:

```js
import ky from 'ky';

const response = await ky.post(url, {
	body: formData,
	hooks: {
		beforeRequest: [
			({request}) => {
				const newFormData = new FormData();

				// Modify FormData as needed
				for (const [key, value] of formData) {
					newFormData.set(key.toLowerCase(), value);
				}

				// Delete `Content-Type` to let Request regenerate it with correct boundary
				request.headers.delete('content-type');

				return new Request(request, {body: newFormData});
			}
		]
	}
});
```

### Setting a custom `Content-Type`

Ky automatically sets an appropriate [`Content-Type`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type) header for each request based on the data in the request body. However, some APIs require custom, non-standard content types, such as `application/x-amz-json-1.1`. Using the `headers` option, you can manually override the content type.

```js
import ky from 'ky';

const json = await ky.post('https://example.com', {
	headers: {
		'content-type': 'application/x-amz-json-1.1'
	},
	json: {
		foo: true
	},
}).json();

console.log(json);
//=> {data: '🦄'}
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

try {
	console.log(await ky(url, {signal}).text());
} catch (error) {
	if (error.name === 'AbortError') {
		console.log('Fetch aborted');
	} else {
		console.error('Fetch error:', error);
	}
}
```

### Proxy support (Node.js)

#### Native proxy support

Node.js 24.5+ supports automatic proxy configuration via environment variables. Set `NODE_USE_ENV_PROXY=1` or use the `--use-env-proxy` CLI flag.

```sh
NODE_USE_ENV_PROXY=1 HTTP_PROXY=http://proxy.example.com:8080 node app.js
```

Or:

```sh
node --use-env-proxy app.js
```

Supported environment variables:
- `HTTP_PROXY` / `http_proxy`: Proxy URL for HTTP requests
- `HTTPS_PROXY` / `https_proxy`: Proxy URL for HTTPS requests
- `NO_PROXY` / `no_proxy`: Comma-separated list of hosts to bypass the proxy

#### Using ProxyAgent

For more control, use `ProxyAgent` or `EnvHttpProxyAgent` with the `dispatcher` option.

```js
import ky from 'ky';
import {ProxyAgent} from 'undici';

const proxyAgent = new ProxyAgent('http://proxy.example.com:8080');

const response = await ky('https://example.com', {
	dispatcher: proxyAgent
}).json();
```

Using `EnvHttpProxyAgent` to automatically read proxy settings from environment variables:

```js
import ky from 'ky';
import {EnvHttpProxyAgent} from 'undici';

const proxyAgent = new EnvHttpProxyAgent();

const api = ky.extend({
	dispatcher: proxyAgent
});

const response = await api('https://example.com').json();
```

### HTTP/2 support (Node.js)

Undici supports HTTP/2, but it's not enabled by default. Create a custom dispatcher with the `allowH2` option:

```js
import ky from 'ky';
import {Agent, Pool} from 'undici';

const agent = new Agent({
	factory(origin, options) {
		return new Pool(origin, {
			...options,
			allowH2: true
		});
	}
});

const response = await ky('https://example.com', {
	dispatcher: agent
}).json();
```

Combine proxy and HTTP/2:

```js
import ky from 'ky';
import {ProxyAgent} from 'undici';

const proxyAgent = new ProxyAgent({
	uri: 'http://proxy.example.com:8080',
	allowH2: true
});

const response = await ky('https://example.com', {
	dispatcher: proxyAgent
}).json();
```

### Streaming request bodies

To send a [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) as the request body, you must pass `duplex: 'half'` per the [Fetch spec](https://fetch.spec.whatwg.org/#dom-requestinit-duplex). Ky can't set this automatically as it changes request semantics for all requests, not just streaming ones.

```js
import ky from 'ky';

const stream = new ReadableStream({
	start(controller) {
		controller.enqueue(new TextEncoder().encode('hello'));
		controller.close();
	},
});

const response = await ky.post('https://example.com/upload', {
	body: stream,
	duplex: 'half',
});
```

> [!NOTE]
> When retries are enabled (the default), Ky buffers the entire streaming body in memory to support replaying it. Set `retry: {limit: 0}` to skip this if retries aren't needed.

### Consuming Server-Sent Events (SSE)

Use [`parse-sse`](https://github.com/sindresorhus/parse-sse):

```js
import ky from 'ky';
import {parseServerSentEvents} from 'parse-sse';

const response = await ky('https://api.example.com/events');

for await (const event of parseServerSentEvents(response)) {
	console.log(event.data);
}
```

### Pagination

Use [`fetch-extras`](https://github.com/sindresorhus/fetch-extras) with Ky for paginating API responses:

```js
import ky from 'ky';
import {paginate} from 'fetch-extras';

const url = 'https://api.github.com/repos/sindresorhus/ky/commits';

for await (const commit of paginate(url, {fetchFunction: ky})) {
	console.log(commit.sha);
}
```

### Extending types

Ky's TypeScript types are intentionally defined as type aliases rather than interfaces to prevent global module augmentation, which can lead to type conflicts and unexpected behavior across your codebase. If you need to add custom properties to Ky's types like `KyResponse` or `HTTPError`, create local wrapper types instead:

```ts
import ky, {HTTPError, isHTTPError} from 'ky';

interface CustomError extends HTTPError {
	customProperty: unknown;
}

const api = ky.extend({
	hooks: {
		beforeError: [
			async ({error}) => {
				if (isHTTPError(error)) {
					(error as CustomError).customProperty = 'value';
				}

				return error;
			}
		]
	}
});

// Use with type assertion
const data = (error as CustomError).customProperty;
```

This approach keeps your types scoped to where they're needed without polluting the global namespace.

## FAQ

#### How do I use this in Node.js?

Node.js supports `fetch` natively, so you can just use this package directly.

#### How do I use this with a web app (React, Vue.js, etc.) that uses server-side rendering (SSR)?

Node.js supports `fetch` natively, so you can use Ky directly. The main consideration is that server-side requests require absolute URLs, while client-side requests can use relative URLs. Handle this with a conditional `baseUrl`:

```js
const api = ky.create({
	baseUrl: globalThis.window === undefined
		? (process.env.BASE_URL ?? 'http://localhost:3000')
		: undefined,
});
```

<a name="baseurl-vs-prefix"></a>
#### What's the difference between `baseUrl` and `prefix`?

**`baseUrl`** follows standard URL resolution rules — the same behavior as `new URL(input, baseUrl)`. A leading slash on the input means origin-root, overriding any path in the base URL.

**`prefix`** does plain string joining before URL resolution. The leading slash on the input is stripped, so it always appends to the prefix regardless.

Use `baseUrl` in almost all cases. Use `prefix` only when you want origin-relative inputs like `/users` to be treated as page-relative.

```js
// On https://example.com

// baseUrl: standard URL resolution
ky('users',  {baseUrl: '/api/'});
//=> https://example.com/api/users

ky('/users', {baseUrl: '/api/'});
//=> https://example.com/users  ← leading slash wins


// prefix: always appends
ky('users',  {prefix: '/api'});
//=> https://example.com/api/users

ky('/users', {prefix: '/api'});
//=> https://example.com/api/users  ← leading slash ignored
```

#### How do I test a browser library that uses this?

Use a test runner that can run in the browser, like [Vitest](https://vitest.dev/guide/browser/) or [Playwright](https://playwright.dev).

#### How do I add authentication headers to every request?

Use the [`beforeRequest` hook](#hooksbeforerequest) to attach headers before each request:

```js
const api = ky.create({
	hooks: {
		beforeRequest: [
			({request}) => {
				request.headers.set('Authorization', `Bearer ${getToken()}`);
			}
		]
	}
});
```

#### How do I implement token refresh on 401 responses?

Configure `retry` to retry on 401, then use the [`beforeRetry` hook](#hooksbeforeretry) to refresh the token:

```js
const api = ky.create({
	retry: {statusCodes: [401]},
	hooks: {
		beforeRetry: [
			async ({request}) => {
				const token = await refreshToken();
				request.headers.set('Authorization', `Bearer ${token}`);
			}
		]
	}
});
```

#### How do I mock Ky in tests?

Use [MSW](https://mswjs.io) to intercept requests at the network level without modifying your code. Alternatively, pass a custom `fetch` to your Ky instance:

```js
const api = ky.create({
	fetch: async () => new Response(JSON.stringify({name: 'Test'}), {
		headers: {
			'Content-Type': 'application/json'
		},
	}),
});
```

#### How do I retry based on the response body?

Use [`ky.retry()`](#kyretryoptions) in an [`afterResponse`](#hooksafterresponse) hook. This lets you force a retry even when the status code is 2xx:

```js
import ky from 'ky';

const response = await ky('https://example.com', {
	hooks: {
		afterResponse: [
			async ({response}) => {
				const data = await response.json();

				if (data.status === 'pending') {
					return ky.retry();
				}
			}
		]
	}
});
```

The retry respects `retry.limit` and is observable in `beforeRetry` hooks.

#### How do I stop retrying early?

Throw from a `beforeRetry` hook to stop retrying and propagate the error, or return [`ky.stop`](#kystop) to stop silently (the request resolves with `undefined`):

```js
import ky, {isHTTPError} from 'ky';

const response = await ky('https://example.com', {
	hooks: {
		beforeRetry: [
			({error}) => {
				if (isHTTPError(error) && error.response.status === 400) {
					throw error; // Stop retrying, propagate the error
				}
			}
		]
	}
});
```

#### How do I only throw on certain HTTP errors?

For simple status-based filtering, pass a function to `throwHttpErrors`:

```js
import ky from 'ky';

// Only throw on 5xx errors; 4xx responses are returned normally
const api = ky.create({
	throwHttpErrors: status => status >= 500,
});

const response = await api('https://example.com/resource');

if (response.status === 404) {
	// Handle "not found" as normal app flow
}
```

If you need to access the response body in the non-throwing path, use `throwHttpErrors: false` and throw manually in an [`afterResponse`](#hooksafterresponse) hook:

```js
import ky, {HTTPError} from 'ky';

const api = ky.create({
	throwHttpErrors: false,
	hooks: {
		afterResponse: [
			({request, options, response}) => {
				if (response.status >= 500) {
					throw new HTTPError(response, request, options);
				}
			}
		]
	}
});
```

#### How do I use this without a bundler like Webpack?

Make sure your code is running as a JavaScript module (ESM), for example by using a `<script type="module">` tag in your HTML document. Then Ky can be imported directly by that module without a bundler or other tools.

```html
<script type="module">
import ky from 'https://unpkg.com/ky/distribution/index.js';

const json = await ky('https://jsonplaceholder.typicode.com/todos/1').json();

console.log(json.title);
//=> 'delectus aut autem'
</script>
```

#### How is it different from [`got`](https://github.com/sindresorhus/got)?

Got is maintained by the same people as Ky, so you probably want Ky instead. It's smaller, works in the browser too, and is more stable since it's built on Fetch.

#### How is it different from [`axios`](https://github.com/axios/axios)?

Axios predates the Fetch API and has a lot of legacy baggage. Ky is built on Fetch, which means it's smaller, more standards-compliant, and works everywhere Fetch does (browsers, Node.js, Bun, Deno). Ky also has a more modern API with better TypeScript support.

#### What does `ky` mean?

It's just a random short npm package name I managed to get. It does, however, have a meaning in Japanese:

> A form of text-able slang, KY is an abbreviation for 空気読めない (kuuki yomenai), which literally translates into “cannot read the air.” It's a phrase applied to someone who misses the implied meaning.

## Browser support

The latest version of Chrome, Firefox, and Safari.

## Node.js support

Node.js 22 and later.

## Related

- [fetch-extras](https://github.com/sindresorhus/fetch-extras) - Useful utilities for working with Fetch
- [ky-hooks-change-case](https://github.com/alice-health/ky-hooks-change-case) - Ky hooks to modify cases on requests and responses of objects

## Maintainers

- [Sindre Sorhus](https://github.com/sindresorhus)
- [Seth Holladay](https://github.com/sholladay)
- [Szymon Marczak](https://github.com/szmarczak)
