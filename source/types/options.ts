import type {LiteralUnion, Required} from './common.js';
import type {Hooks} from './hooks.js';
import type {RetryOptions} from './retry.js';

// eslint-disable-next-line unicorn/prevent-abbreviations
export type SearchParamsInit = string | string[][] | Record<string, string> | URLSearchParams | undefined;

// eslint-disable-next-line unicorn/prevent-abbreviations
export type SearchParamsOption = SearchParamsInit | Record<string, string | number | boolean | undefined> | Array<Array<string | number | boolean>>;

export type RequestHttpMethod = 'get' | 'post' | 'put' | 'patch' | 'head' | 'delete';
export type HttpMethod = LiteralUnion<RequestHttpMethod | 'options' | 'trace', string>;

export type Input = string | URL | Request;

export type Progress = {
	percent: number;
	transferredBytes: number;

	/**
	Note: If it's not possible to retrieve the body size, it will be `0`.
	*/
	totalBytes: number;
};

// Not HeadersInit directly because @types/node doesn't export it
export type KyHeadersInit = NonNullable<RequestInit['headers']> | Record<string, string | undefined>;

/**
Custom Ky options
*/

export type KyOptions = {
	/**
	Shortcut for sending JSON. Use this instead of the `body` option.

	Accepts any plain object or value, which will be stringified using `JSON.stringify()` and sent in the body with the correct header set.
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
	parseJson?: (text: string, context: {request: Request; response: Response}) => unknown;

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
	stringifyJson?: (data: unknown) => string;

	/**
	Search parameters to include in the request URL. Setting this will merge with any existing search parameters in the input URL.

	Accepts any value supported by [`URLSearchParams()`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams/URLSearchParams).

	When passing an object, setting a value to `undefined` deletes the parameter, while `null` values are preserved and converted to the string `'null'`.
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
	baseUrl?: URL | string;

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
	prefix?: URL | string;

	/**
	An object representing `limit`, `methods`, `statusCodes`, `afterStatusCodes`, `maxRetryAfter`, `backoffLimit`, `delay`, `jitter`, `retryOnTimeout`, and `shouldRetry` fields for maximum retry count, allowed methods, allowed status codes, status codes allowed to use the [`Retry-After`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After) time, maximum [`Retry-After`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After) time, backoff limit, delay calculation function, retry jitter, timeout retry behavior, and custom retry logic.

	If `retry` is a number, it will be used as `limit` and other defaults will remain in place.

	Network errors (e.g., DNS failures, connection refused, offline) are automatically retried for retriable methods. Only errors recognized as network errors are retried; other errors (e.g., programming bugs) are thrown immediately. Use `shouldRetry` to customize this behavior.

	If the response provides an HTTP status contained in `afterStatusCodes`, Ky will wait until the date, timeout, or timestamp given in the [`Retry-After`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After) header has passed to retry the request. If `Retry-After` is missing, the non-standard [`RateLimit-Reset`](https://www.ietf.org/archive/id/draft-polli-ratelimit-headers-05.html#section-3.3) header is used in its place as a fallback. If the provided status code is not in the list, the [`Retry-After`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After) header will be ignored.

	If `maxRetryAfter` is set to `undefined`, it will use `options.timeout`. If [`Retry-After`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After) header is greater than `maxRetryAfter`, it will use `maxRetryAfter`.

	@example
	```
	import ky from 'ky';

	const json = await ky('https://example.com', {
		retry: {
			limit: 10,
			methods: ['get'],
			statusCodes: [413]
		}
	}).json();
	```
	*/
	retry?: RetryOptions | number;

	/**
	Per-attempt timeout in milliseconds for getting a response, applied independently to each retry. Cannot be greater than 2147483647. See also `totalTimeout`.

	If set to `false`, there will be no per-attempt timeout.

	@default 10000
	*/
	timeout?: number | false;

	/**
	Overall timeout in milliseconds for the entire operation, including retries and delays. Throws a `TimeoutError` if exceeded. Cannot be greater than 2147483647.

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
	totalTimeout?: number | false;

	/**
	Hooks allow modifications during the request lifecycle. Hook functions may be async and are run serially.
	*/
	hooks?: Hooks;

	/**
	Throw an `HTTPError` when, after following redirects, the response has a non-2xx status code. To also throw for redirects instead of following them, set the [`redirect`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Parameters) option to `'manual'`.

	Setting this to `false` may be useful if you are checking for resource availability and are expecting error responses.

	You can also pass a function that accepts the HTTP status code and returns a boolean for selective error handling. Note that this can violate the principle of least surprise, so it's recommended to use the boolean form unless you have a specific use case like treating 404 responses differently.

	Note: If `false`, error responses are considered successful and the request will not be retried.

	Note: [Opaque responses](https://developer.mozilla.org/en-US/docs/Web/API/Response/type) from `no-cors` requests are returned as-is (without throwing `HTTPError`), since the actual status is hidden by the browser.

	@default true
	*/
	throwHttpErrors?: boolean | ((status: number) => boolean);

	/**
	Download progress event handler.

	@param progress - Object containing download progress information.
	@param chunk - Data that was received. Note: It's empty for the first call.

	@example
	```
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
	*/
	onDownloadProgress?: (progress: Progress, chunk: Uint8Array) => void;

	/**
	Upload progress event handler.

	Note: Requires [request stream support](https://caniuse.com/wf-fetch-request-streams) and HTTP/2 for HTTPS connections (in Chromium-based browsers). In unsupported environments, this handler is silently ignored.

	@param progress - Object containing upload progress information.
	@param chunk - Data that was sent. Note: It's empty for the last call.

	@example
	```
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
	*/
	onUploadProgress?: (progress: Progress, chunk: Uint8Array) => void;

	/**
	User-defined `fetch` function.
	Has to be fully compatible with the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) standard.

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
	fetch?: (input: Input, init?: RequestInit) => Promise<Response>;

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
	*/
	context?: Record<string, unknown>;
};

/**
Each key from KyOptions is present and set to `true`.

This type is used for identifying and working with the known keys in KyOptions.
*/
export type KyOptionsRegistry = {[K in keyof KyOptions]-?: true};

/**
Options are the same as `window.fetch`, except for the KyOptions
*/
export interface Options extends KyOptions, Omit<RequestInit, 'headers'> { // eslint-disable-line @typescript-eslint/consistent-type-definitions -- This must stay an interface so that it can be extended outside of Ky for use in `ky.create`.
	/**
	HTTP method used to make the request.

	Internally, the standard methods (`GET`, `POST`, `PUT`, `PATCH`, `HEAD` and `DELETE`) are uppercased in order to avoid server errors due to case sensitivity.
	*/
	method?: LiteralUnion<HttpMethod, string>;

	/**
	HTTP headers used to make the request.

	You can pass a `Headers` instance or a plain object.

	You can remove a header with `.extend()` by passing the header with an `undefined` value.

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

	const response = await extended(url).json();

	console.log('rainbow' in response);
	//=> false

	console.log('unicorn' in response);
	//=> true
	```
	*/
	headers?: KyHeadersInit;
}

export type InternalOptions = Required<
	Omit<Options, 'hooks' | 'retry' | 'context' | 'throwHttpErrors'>,
'fetch' | 'prefix' | 'timeout' | 'totalTimeout'
> & {
	headers: Required<Headers>;
	hooks: Required<Hooks>;
	retry: Required<Omit<RetryOptions, 'shouldRetry'>> & Pick<RetryOptions, 'shouldRetry'>;
	prefix: string;
	context: Record<string, unknown>;
	throwHttpErrors: boolean | ((status: number) => boolean);
};

/**
Normalized options passed to the `fetch` call and hooks.
*/
export interface NormalizedOptions extends RequestInit { // eslint-disable-line @typescript-eslint/consistent-type-definitions -- This must stay an interface so that it can be extended outside of Ky for use in `ky.create`.
	// Extended from `RequestInit`, but ensured to be set (not optional).
	method: NonNullable<RequestInit['method']>;
	credentials?: NonNullable<RequestInit['credentials']>;

	// Extended from custom `KyOptions`, but ensured to be set (not optional).
	retry: RetryOptions;
	baseUrl?: Options['baseUrl'];
	prefix: string;
	onDownloadProgress: Options['onDownloadProgress'];
	onUploadProgress: Options['onUploadProgress'];
	context: Record<string, unknown>;
}

export type {RetryOptions, ShouldRetryState} from './retry.js';
