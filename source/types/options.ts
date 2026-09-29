import type {LiteralUnion} from './common.js';
import type {Hooks, NormalizedHooks} from './hooks.js';
import type {MutableRetryOptions, RetryOptions} from './retry.js';

// eslint-disable-next-line unicorn/prevent-abbreviations
export type SearchParamsInit = string | string[][] | Record<string, string> | URLSearchParams | undefined;

// `null` is intentionally not allowed in the object form even though the runtime sends it as the string `'null'` (like `URLSearchParams` does), so accidental nulls are caught by the type checker.
// eslint-disable-next-line unicorn/prevent-abbreviations
export type SearchParamsOption =
	| Exclude<SearchParamsInit, string[][]>
	| Record<string, string | number | boolean | undefined>
	| Array<Array<string | number | boolean>>
	| ReadonlyArray<ReadonlyArray<string | number | boolean>>;

export type RequestHttpMethod = 'get' | 'post' | 'put' | 'patch' | 'head' | 'delete' | 'query';
export type HttpMethod = LiteralUnion<RequestHttpMethod | 'options' | 'trace', string>;

export type Input = string | URL | Request;

export type Progress = {
	/**
	A number between `0` and `1` representing the progress percentage.
	*/
	percent: number;

	/**
	The number of bytes transferred so far.
	*/
	transferredBytes: number;

	/**
	The total number of bytes to be transferred. This is an estimate and may be `0` for an empty transfer or when the total size cannot be determined.
	*/
	totalBytes: number;
};

// Not HeadersInit directly because @types/node doesn't export it
export type KyHeadersInit = NonNullable<RequestInit['headers']> | Record<string, string | undefined> | ReadonlyArray<readonly [string, string]>;

/**
Custom Ky options
*/

export type KyOptions = {
	/**
	Shortcut for sending JSON. Use this instead of the `body` option.

	Accepts any plain object or value, which will be stringified using `JSON.stringify()` and sent in the body with the correct header set.

	The `Content-Type` header is set to `application/json` unless you set a `Content-Type` in the `headers` option, which always takes precedence. A `Content-Type` on a `Request` input is replaced, because the `Request` constructor sets one automatically from its body.
	*/
	json?: unknown;

	/**
	User-defined JSON-parsing function.

	The function receives the response text as the first argument and a context object as the second argument containing the `request` and `response`.

	Use-cases:
	1. Parse JSON via the [`bourne` package](https://github.com/hapijs/bourne) to protect from prototype pollution.
	2. Parse JSON with [`reviver` option of `JSON.parse()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse).
	3. Log or handle JSON parse errors with request context.

	@default JSON.parse()

	@example
	```
	import ky from 'ky';
	import bourne from '@hapijs/bourne';

	const json = await ky('https://example.com', {
		parseJson: text => bourne(text)
	}).json();
	```

	@example
	```
	import ky from 'ky';

	const json = await ky('https://example.com', {
		parseJson: (text, {request, response}) => {
			console.log(`Parsing JSON from ${request.url} (status: ${response.status})`);
			return JSON.parse(text);
		}
	}).json();
	```
	*/
	// `options` is intentionally not included in the context to avoid exposing Ky internals through a parsing callback. `request`/`response` already provide the metadata needed for logging.
	parseJson?: ((text: string, context: {request: Request; response: Response}) => unknown) | undefined;

	/**
	User-defined JSON-stringifying function.

	Use-cases:
	1. Stringify JSON with a custom `replacer` function.

	@default JSON.stringify()

	@example
	```
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
	*/
	stringifyJson?: ((data: unknown) => string) | undefined;

	/**
	Search parameters to include in the request URL. Setting this will merge with any existing search parameters in the input URL.

	Accepts any value supported by [`URLSearchParams()`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams/URLSearchParams).

	When passing an object, setting a value to `undefined` deletes the parameter, including from the input URL, even when a later option layer adds the parameter again. `null` values are preserved and converted to the string `'null'`.

	When `input` is a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) with a body, the body is sent as a stream, which requires [request stream support](https://caniuse.com/wf-fetch-request-streams) and, in Chromium-based browsers, an HTTP/2 or HTTP/3 connection (streaming uploads over HTTP/1.1 fail with a network error, even over plain HTTP). The inherited body is dropped when the search parameters change the URL and the request has to be rebuilt in an environment that cannot reuse it, which is the case without request stream support, when `keepalive` is true, or when the effective mode is `'no-cors'`. A search parameter value that leaves the URL unchanged does not rebuild the request, so the body is kept. A compatible body passed explicitly with the `body` option is still used.
	*/
	searchParams?: SearchParamsOption;

	/**
	A base URL to [resolve](https://developer.mozilla.org/en-US/docs/Web/API/URL_API/Resolving_relative_references) the `input` against. When the `input` (after applying the `prefix` option) is only a relative URL, such as `'users'`, `'/users'`, or `'//my-site.com'`, it will be resolved against the `baseUrl` to determine the destination of the request. Otherwise, the `input` is absolute, such as `'https://my-site.com'`, and it will bypass the `baseUrl`.

	Useful when used with [`ky.extend()`](#kyextenddefaultoptions) to create niche-specific Ky instances.

	If the `baseUrl` itself is relative, it will be resolved against the environment's base URL, such as [`document.baseURI`](https://developer.mozilla.org/en-US/docs/Web/API/Node/baseURI) in browsers or `location.href` in Deno (see the `--location` flag).

	**Tip:** When setting a `baseUrl` that has a path, we recommend that it include a trailing slash `/`, as in `'/api/'` rather than `/api`. This ensures more intuitive behavior for page-relative `input` URLs, such as `'users'` or `'./users'`, where they will _extend_ from the full path of the `baseUrl` rather than _replacing_ its last path segment.

	@example
	```
	import ky from 'ky';

	// On https://example.com

	const response = await ky('users', {baseUrl: '/api/'});
	//=> 'https://example.com/api/users'

	const response = await ky('/users', {baseUrl: '/api/'});
	//=> 'https://example.com/users'
	```
	*/
	baseUrl?: URL | string | undefined;

	/**
	A prefix to prepend to the `input` before making the request (and before it is resolved against the `baseUrl`). It can be any valid path or URL, either relative or absolute. A trailing slash `/` is optional and will be added automatically, if needed, when it is joined with `input`. Only takes effect when `input` is a string.

	Useful when used with [`ky.extend()`](#kyextenddefaultoptions) to create niche-specific Ky instances.

	*In most cases, you should use the `baseUrl` option instead, as it is more consistent with web standards. However, `prefix` is useful if you want origin-relative `input` URLs, such as `/users`, to be treated as if they were page-relative. In other words, the leading slash of the `input` will essentially be ignored, because the `prefix` will become part of the `input` before URL resolution happens.*

	Notes:
	- The `prefix` and `input` are joined with a slash `/`, and slashes are normalized at the join boundary by trimming trailing slashes from `prefix` and leading slashes from `input`.
	- After `prefix` and `input` are joined, the result is resolved against the `baseUrl` option, if present.

	@example
	```
	import ky from 'ky';

	// On https://example.com

	const response = await ky('users', {prefix: '/api/'});
	//=> 'https://example.com/api/users'

	const response = await ky('/users', {prefix: '/api/'});
	//=> 'https://example.com/api/users'
	```
	*/
	prefix?: URL | string | undefined;

	/**
	Controls retry behavior. Each field is documented in the `RetryOptions` type.

	If `retry` is a number, it will be used as `limit` and other defaults will remain in place.

	`retry.limit`, including numeric shorthand, must be a finite, non-negative integer.

	Network errors (e.g., DNS failures, connection refused, offline) are automatically retried for retriable methods. Only errors recognized as network errors are retried; other errors (e.g., programming bugs) are thrown immediately. Use `shouldRetry` to customize this behavior.

	A hook can change `retry.limit` through `options`. Ky reads the limit again when each attempt starts. A `beforeRequest` or `beforeRetry` hook runs before the attempt starts, so it can lower or raise the limit. An `afterResponse` hook runs after the attempt started, so it can lower the limit, for example to stop retrying once a response says so. A higher limit set there only applies from the next attempt.

	`413 Payload Too Large` is only retried when the response includes a retry timing header, unless `shouldRetry` returns `true`.

	When the response status is contained in `afterStatusCodes` and the retry is allowed by `statusCodes` or `shouldRetry`, Ky uses retry timing headers to choose the retry delay. [`Retry-After`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After) may provide a delay in seconds or an HTTP-date. If `Retry-After` is missing, Ky falls back to rate-limit timing headers (`RateLimit-Reset`, `X-RateLimit-Retry-After`, `X-RateLimit-Reset`, and `X-Rate-Limit-Reset`). Numeric `Retry-After` and `X-RateLimit-Retry-After` values are interpreted as delay seconds. Numeric `RateLimit-Reset`, `X-RateLimit-Reset`, and `X-Rate-Limit-Reset` values may also be interpreted as Unix timestamps, from 2001-09-09 onwards. A value below that is read as delay seconds, and a timestamp already in the past means the retry happens immediately. If the status code is not in `afterStatusCodes`, retry timing headers will be ignored.

	If the retry delay from a retry timing header is greater than `maxRetryAfter`, Ky will use `maxRetryAfter`.

	@example
	```
	import ky from 'ky';

	const json = await ky('https://example.com', {
		retry: {
			limit: 10,
			methods: ['get'],
			statusCodes: [500]
		}
	}).json();
	```
	*/
	retry?: RetryOptions | number | undefined;

	/**
	Per-attempt timeout in milliseconds for getting a response, applied independently to each retry. Ky shortcut methods also use this value as a separate timeout for reading the response body. Must be a non-negative number or `false`, or a `TypeError` is thrown. A value greater than 2147483647, `Infinity` included, throws a `RangeError`. See also `totalTimeout`.

	If set to `false`, there will be no per-attempt timeout.

	If the signal you passed in is aborted while a body method is reading, or just after the read finished, the body method rejects with the abort reason rather than resolving with the bytes that already arrived.

	@default 10000
	*/
	timeout?: number | false | undefined;

	/**
	Overall timeout in milliseconds for the entire operation, including retries and delays. Throws a `TimeoutError` if exceeded. Must be a non-negative number or `false`, or a `TypeError` is thrown. A value greater than 2147483647, `Infinity` included, throws a `RangeError`.

	`beforeError` hooks run after an error is produced and are not bounded by `totalTimeout`.

	If set to `false` or not specified, there is no overall timeout.

	@default false

	@example
	```
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
	*/
	totalTimeout?: number | false | undefined;

	/**
	Maximum response body size in bytes. Must be a non-negative safe integer or `Infinity`. Set to `0` to allow only empty bodies.

	The limit counts bytes from the response stream after decompression, independently of `Content-Length`. It applies as the body is consumed, including in `afterResponse` hooks and for responses returned by hooks. Exceeding the limit cancels the stream and throws a `ResponseSizeError`, without automatically retrying.

	With `await ky(url)`, the response can resolve before the limit is exceeded; the body read will reject instead. This limits body bytes, not total memory usage. Parsing, buffering, and concurrent requests can use additional memory.

	Responses with a [null body status](https://fetch.spec.whatwg.org/#null-body-status), such as `204` and `205`, are never wrapped, because the `Response` constructor rejects a body for those statuses. A runtime that still exposes a body for such a status, such as WebKit for `205`, is therefore not limited.

	@default Infinity

	@example
	```
	import ky from 'ky';

	const data = await ky('https://example.com/data', {
		maxResponseSize: 20 * 1024 * 1024,
	}).json();
	```
	*/
	maxResponseSize?: number | undefined;

	/**
	Hooks allow modifications during the request lifecycle. Hook functions may be async and are run serially, unless otherwise noted.

	Each hook must be an array of functions. A single function, a string, or any other value, `null` included, throws a `TypeError` rather than being silently dropped. `undefined` means absent, so it clears the hooks it would have replaced.
	*/
	hooks?: Hooks | undefined;

	/**
	Throw an `HTTPError` when, after following redirects, the response has a non-2xx status code. To also throw for redirects instead of following them, set the [`redirect`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Parameters) option to `'manual'`.

	Setting this to `false` may be useful if you are checking for resource availability and are expecting error responses.

	You can also pass a function that accepts the HTTP status code and returns a boolean for selective error handling. Note that this can violate the principle of least surprise, so it's recommended to use the boolean form unless you have a specific use case like treating 404 responses differently.

	Note: If `false`, error responses are considered successful and the request will not be retried.

	Note: [Opaque responses](https://developer.mozilla.org/en-US/docs/Web/API/Response/type) from `no-cors` requests are returned as-is (without throwing `HTTPError`), since the actual status is hidden by the browser.

	@default true
	*/
	throwHttpErrors?: boolean | ((status: number) => boolean) | undefined;

	/**
	Download progress event handler.

	@param progress - Object containing download progress information.
	@param chunk - Data that was received. When an empty response body stream completes, the callback receives an empty chunk.

	`content-length` is only used as the total for a response that is not content-coded, since it counts encoded bytes while the progress stream counts the bytes after decompression. A compressed response therefore reports `totalBytes: 0` until it completes, which means the percentage cannot be calculated while downloading.

	Responses with no body at all are not streamed, so no progress events are emitted for them. That covers a [null body status](https://fetch.spec.whatwg.org/#null-body-status) such as `204`, and a `HEAD` response in runtimes that give it no body, such as browsers, Node.js and Deno. Bun gives a `HEAD` response an empty body, so it reports one final event with `transferredBytes: 0`. A response whose body an `afterResponse` hook already read, or locked with a reader, is passed through unchanged, so it reports no progress either.

	Do not throw from the callback. A throw fails the response stream, which the runtime reports in its own way: Node.js rejects the body read with your error, while Chromium reports a network failure, so Ky's body methods throw a `NetworkError` there. Pass a `signal` from an `AbortController` to cancel instead.

	@example
	```
	import ky from 'ky';

	const response = await ky('https://example.com', {
		onDownloadProgress: (progress, chunk) => {
			// Example output:
			// `100% - 1271 of 1271 bytes`
			console.log(`${progress.percent * 100}% - ${progress.transferredBytes} of ${progress.totalBytes} bytes`);
		}
	});
	```
	*/
	onDownloadProgress?: ((progress: Progress, chunk: Uint8Array) => void) | undefined;

	/**
	Upload progress event handler.

	Note: Requires [request stream support](https://caniuse.com/wf-fetch-request-streams) and, in Chromium-based browsers, an HTTP/2 or HTTP/3 connection (streaming uploads over HTTP/1.1 fail with a network error, even over plain HTTP). This handler is silently ignored in unsupported environments and for requests with `keepalive: true` or `mode: 'no-cors'`, since they cannot use streaming request bodies.

	@param progress - Object containing upload progress information.
	@param chunk - Data that was sent. When an empty request body stream completes, the callback receives an empty chunk.

	A `ReadableStream` body cannot be measured, so `totalBytes` falls back to a `content-length` header you set. Browsers do not allow that header on a request, so there the total stays `0`. When a hook replaces the request, `totalBytes` is still estimated from the `body` option until the final event, which reports the real total.

	Do not throw from the callback. A throw fails the upload stream, which the runtime reports as a network failure, so Ky throws a `NetworkError` (in Node.js, with your error in its `cause` chain) and retries it like any other network error, running the callback again. Pass a `signal` from an `AbortController` to cancel instead.

	@example
	```
	import ky from 'ky';

	const response = await ky.post('https://example.com/upload', {
		body: largeFile,
		onUploadProgress: (progress, chunk) => {
			// Example output:
			// `100% - 1271 of 1271 bytes`
			console.log(`${progress.percent * 100}% - ${progress.transferredBytes} of ${progress.totalBytes} bytes`);
		}
	});
	```
	*/
	onUploadProgress?: ((progress: Progress, chunk: Uint8Array) => void) | undefined;

	/**
	User-defined `fetch` function.
	Has to be fully compatible with the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) standard. It must resolve with a `Response`, or a `TypeError` is thrown.

	Use-cases:
	1. Use the `fetch` wrapper function provided by some frameworks that use server-side rendering (SSR).
	2. Add custom instrumentation or logging to all requests.

	@default fetch

	@example
	```
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
	*/
	fetch?: ((input: Request, init?: RequestInit) => Promise<Response>) | undefined;

	/**
	User-defined data passed to hooks.

	This option allows you to pass arbitrary contextual data to hooks without polluting the request itself. The context is available in all hooks and is **guaranteed to always be an object** (never `undefined`), so you can safely access properties without optional chaining.

	Use cases:
	- Pass authentication tokens or API keys to hooks
	- Attach request metadata for logging or debugging
	- Implement conditional logic in hooks based on the request context
	- Pass serverless environment bindings (e.g., Cloudflare Workers)

	**Note:** Context is shallow merged. Top-level properties are merged, but nested objects are replaced. Only enumerable properties are copied.

	@example
	```
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

	@default {}
	*/
	context?: Record<string, unknown> | undefined;
};

/**
Each key from KyOptions is present and set to `true`.

This type is used for identifying and working with the known keys in KyOptions.
*/
export type KyOptionsRegistry = {[K in keyof KyOptions]-?: true};

type RequestOptions = {
	[Key in Exclude<keyof RequestInit, 'headers' | 'signal' | 'method'>]?: RequestInit[Key] | undefined;
};

/**
Options are the same as `window.fetch`, except for the KyOptions
*/
export interface Options extends KyOptions, RequestOptions { // eslint-disable-line @typescript-eslint/consistent-type-definitions -- This must stay an interface so that it can be extended outside of Ky for use in `ky.create`.
	/**
	HTTP method used to make the request.

	Internally, the standard methods (`GET`, `POST`, `PUT`, `PATCH`, `HEAD`, `DELETE`, and `QUERY`) are uppercased in order to avoid server errors due to case sensitivity.
	*/
	method?: LiteralUnion<HttpMethod, string> | undefined;

	/**
	HTTP headers used to make the request.

	You can pass a `Headers` instance or a plain object. Headers are normalized to a plain object with lowercase names when options are merged, so `init` hooks always see a plain object with lowercase keys. A header removed with `undefined` stays in that object with an `undefined` value.

	You can remove a header with `.extend()` by passing the header with an `undefined` value. Passing `undefined` as a string removes the header only if it comes from a `Headers` instance.

	@example
	```
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

	const response = await extended(url);

	console.log(response.headers.has('rainbow'));
	//=> false

	console.log(response.headers.has('unicorn'));
	//=> true
	```
	*/
	headers?: KyHeadersInit | undefined;

	/**
	An `AbortSignal` to abort the request.

	When extending an instance, signals are combined. Use `replaceOption(signal)` to replace inherited signals, or `signal: undefined` to remove them.

	`null` is accepted for `RequestInit` compatibility and is treated like an absent signal, so it does not remove an inherited signal.
	*/
	// eslint-disable-next-line @typescript-eslint/no-restricted-types
	signal?: AbortSignal | null | undefined;
}

export type InitOptions = Omit<Options, 'retry' | 'hooks'> & {
	retry?: MutableRetryOptions | number | undefined;
	hooks?: {[Key in keyof Hooks]?: NormalizedHooks[Key] | undefined} | undefined;
};

type NormalizedRetryOptions = {
	[Key in Exclude<keyof MutableRetryOptions, 'shouldRetry'>]-?: Key extends 'jitter' ? MutableRetryOptions[Key] : Exclude<MutableRetryOptions[Key], undefined>;
} & Pick<MutableRetryOptions, 'shouldRetry'>;

export type InternalOptions = Omit<Options, 'hooks' | 'retry' | 'context' | 'throwHttpErrors'> & {
	headers: Headers;
	hooks: NormalizedHooks;
	retry: NormalizedRetryOptions;
	fetch: NonNullable<Options['fetch']>;
	prefix: string;
	timeout: number | false;
	totalTimeout: number | false;
	maxResponseSize: number;
	context: Record<string, unknown>;
	throwHttpErrors: boolean | ((status: number) => boolean);
};

/**
Normalized options passed to the `fetch` call and hooks.
*/
export interface NormalizedOptions extends Readonly<RequestInit> { // eslint-disable-line @typescript-eslint/consistent-type-definitions -- This must stay an interface so that it can be extended outside of Ky for use in `ky.create`.
	// Extended from `RequestInit`, but ensured to be set (not optional).
	readonly method: NonNullable<RequestInit['method']>;
	readonly credentials?: NonNullable<RequestInit['credentials']>;
	readonly headers: Headers;

	// Extended from custom `KyOptions`, but ensured to be set (not optional).
	readonly retry: NormalizedRetryOptions;
	readonly baseUrl?: Options['baseUrl'];
	readonly prefix: string;
	readonly onDownloadProgress?: NonNullable<Options['onDownloadProgress']>;
	readonly onUploadProgress?: NonNullable<Options['onUploadProgress']>;
	readonly context: Record<string, unknown>;
}

export type {RetryOptions, ShouldRetryState} from './retry.js';
