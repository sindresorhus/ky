type Primitive = null | undefined | string | number | boolean | symbol | bigint;

type LiteralUnion<LiteralType extends BaseType, BaseType extends Primitive> =
	| LiteralType
	| (BaseType & {_?: never});

export type Input = Request | URL | string;

export type BeforeRequestHook = (
	request: Request,
	options: NormalizedOptions,
) => Request | Response | void | Promise<Request | Response | void>;

export type BeforeRetryState = {
	request: Request;
	response: Response;
	options: NormalizedOptions;
	error: Error;
	retryCount: number;
};
export type BeforeRetryHook = (
	options: BeforeRetryState
) => typeof ky.stop | void | Promise<typeof ky.stop | void>;

export type AfterResponseHook = (
	request: Request,
	options: NormalizedOptions,
	response: Response,
) => Response | void | Promise<Response | void>;

export interface DownloadProgress {
	percent: number;
	transferredBytes: number;

	/**
	Note: If it's not possible to retrieve the body size, it will be `0`.
	*/
	totalBytes: number;
}

export interface Hooks {
	/**
	This hook enables you to modify the request right before it is sent. Ky will make no further changes to the request after this. The hook function receives normalized input and options as arguments. You could, for example, modify `options.headers` here.

	A [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) can be returned from this hook to completely avoid making a HTTP request. This can be used to mock a request, check an internal cache, etc. An **important** consideration when returning a `Response` from this hook is that all the following hooks will be skipped, so **ensure you only return a `Response` from the last hook**.

	@default []
	*/
	beforeRequest?: BeforeRequestHook[];

	/**
	This hook enables you to modify the request right before retry. Ky will make no further changes to the request after this. The hook function receives an object with the normalized request and options, an error instance, and the retry count. You could, for example, modify `request.headers` here.

	If the request received a response, the error will be of type `HTTPError` and the `Response` object will be available at `error.response`. Be aware that some types of errors, such as network errors, inherently mean that a response was not received. In that case, the error will not be an instance of `HTTPError`.

	You can prevent Ky from retrying the request by throwing an error. Ky will not handle it in any way and the error will be propagated to the request initiator. The rest of the `beforeRetry` hooks will not be called in this case. Alternatively, you can return the [`ky.stop`](#ky.stop) symbol to do the same thing but without propagating an error (this has some limitations, see `ky.stop` docs for details).

	@example
	```
	import ky from 'ky';

	const response = await ky('https://example.com', {
		hooks: {
			beforeRetry: [
				async ({request, options, error, retryCount}) => {
					const token = await ky('https://example.com/refresh-token');
					options.headers.set('Authorization', `token ${token}`);
				}
			]
		}
	});
	```

	@default []
	*/
	beforeRetry?: BeforeRetryHook[];

	/**
	This hook enables you to read and optionally modify the response. The hook function receives normalized input, options, and a clone of the response as arguments. The return value of the hook function will be used by Ky as the response object if it's an instance of [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response).

	@default []

	@example
	```
	import ky from 'ky';

	const response = await ky('https://example.com', {
		hooks: {
			afterResponse: [
				(_input, _options, response) => {
					// You could do something with the response, for example, logging.
					log(response);

					// Or return a `Response` instance to overwrite the response.
					return new Response('A different response', {status: 200});
				},

				// Or retry with a fresh token on a 403 error
				async (input, options, response) => {
					if (response.status === 403) {
						// Get a fresh token
						const token = await ky('https://example.com/token').text();

						// Retry with the token
						options.headers.set('Authorization', `token ${token}`);

						return ky(input, options);
					}
				}
			]
		}
	});
	```
	*/
	afterResponse?: AfterResponseHook[];
}

export interface RetryOptions {
	/**
	The number of times to retry failed requests.

	@default 2
	*/
	limit?: number;

	/**
	The HTTP methods allowed to retry.

	@default ['get', 'put', 'head', 'delete', 'options', 'trace']
	*/
	methods?: string[];

	/**
	The HTTP status codes allowed to retry.

	@default [408, 413, 429, 500, 502, 503, 504]
	*/
	statusCodes?: number[];

	/**
	The HTTP status codes allowed to retry with a `Retry-After` header.

	@default [413, 429, 503]
	*/
	afterStatusCodes?: number[];

	/**
	If the `Retry-After` header is greater than `maxRetryAfter`, the request will be canceled.

	@default Infinity
	*/
	maxRetryAfter?: number;
}

/**
Options are the same as `window.fetch`, with some exceptions.
*/
export interface Options extends Omit<RequestInit, 'headers'> {
	/**
	HTTP method used to make the request.

	Internally, the standard methods (`GET`, `POST`, `PUT`, `PATCH`, `HEAD` and `DELETE`) are uppercased in order to avoid server errors due to case sensitivity.
	*/
	method?: LiteralUnion<'get' | 'post' | 'put' | 'delete' | 'patch' | 'head', string>;

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
	headers?: HeadersInit | {[key: string]: undefined};

	/**
	Shortcut for sending JSON. Use this instead of the `body` option.

	Accepts any plain object or value, which will be `JSON.stringify()`'d and sent in the body with the correct header set.
	*/
	json?: unknown;

	/**
	User-defined JSON-parsing function.

	Use-cases:
	1. Parse JSON via the [`bourne` package](https://github.com/hapijs/bourne) to protect from prototype pollution.
	2. Parse JSON with [`reviver` option of `JSON.parse()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse).

	@default JSON.parse()

	@example
	```
	import ky from 'ky';
	import bourne from '@hapijs/bourne';

	const json = await ky('https://example.com', {
		parseJson: text => bourne(text)
	}).json();
	```
	*/
	parseJson?: (text: string) => unknown

	/**
	Search parameters to include in the request URL. Setting this will override all existing search parameters in the input URL.

	Accepts any value supported by [`URLSearchParams()`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams/URLSearchParams).
	*/
	searchParams?: string | {[key: string]: string | number | boolean} | Array<Array<string | number | boolean>> | URLSearchParams;

	/**
	A prefix to prepend to the `input` URL when making the request. It can be any valid URL, either relative or absolute. A trailing slash `/` is optional and will be added automatically, if needed, when it is joined with `input`. Only takes effect when `input` is a string. The `input` argument cannot start with a slash `/` when using this option.

	Useful when used with [`ky.extend()`](#kyextenddefaultoptions) to create niche-specific Ky-instances.

	Notes:
	 - After `prefixUrl` and `input` are joined, the result is resolved against the [base URL](https://developer.mozilla.org/en-US/docs/Web/API/Node/baseURI) of the page (if any).
	 - Leading slashes in `input` are disallowed when using this option to enforce consistency and avoid confusion about how the `input` URL is handled, given that `input` will not follow the normal URL resolution rules when `prefixUrl` is being used, which changes the meaning of a leading slash.

	@example
	```
	import ky from 'ky';

	// On https://example.com

	const response = await ky('unicorn', {prefixUrl: '/api'});
	//=> 'https://example.com/api/unicorn'

	const response = await ky('unicorn', {prefixUrl: 'https://cats.com'});
	//=> 'https://cats.com/unicorn'
	```
	*/
	prefixUrl?: URL | string;

	/**
	An object representing `limit`, `methods`, `statusCodes` and `maxRetryAfter` fields for maximum retry count, allowed methods, allowed status codes and maximum [`Retry-After`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After) time.

	If `retry` is a number, it will be used as `limit` and other defaults will remain in place.

	If `maxRetryAfter` is set to `undefined`, it will use `options.timeout`. If [`Retry-After`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After) header is greater than `maxRetryAfter`, it will cancel the request.

	Delays between retries is calculated with the function `0.3 * (2 ** (retry - 1)) * 1000`, where `retry` is the attempt number (starts from 1).

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
	Timeout in milliseconds for getting a response. Can not be greater than 2147483647.
	If set to `false`, there will be no timeout.

	@default 10000
	*/
	timeout?: number | false;

	/**
	Hooks allow modifications during the request lifecycle. Hook functions may be async and are run serially.
	*/
	hooks?: Hooks;

	/**
	Throw an `HTTPError` when, after following redirects, the response has a non-2xx status code. To also throw for redirects instead of following them, set the [`redirect`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Parameters) option to `'manual'`.

	Setting this to `false` may be useful if you are checking for resource availability and are expecting error responses.

	@default true
	*/
	throwHttpErrors?: boolean;

	/**
	Download progress event handler.

	@param chunk - Note: It's empty for the first call.

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
	onDownloadProgress?: (progress: DownloadProgress, chunk: Uint8Array) => void;

	/**
	User-defined `fetch` function.
	Has to be fully compatible with the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) standard.

	Use-cases:
	1. Use custom `fetch` implementations like [`isomorphic-unfetch`](https://www.npmjs.com/package/isomorphic-unfetch).
	2. Use the `fetch` wrapper function provided by some frameworks that use server-side rendering (SSR).

	@default fetch

	@example
	```
	import ky from 'ky';
	import fetch from 'isomorphic-unfetch';

	const json = await ky('https://example.com', {fetch}).json();
	```
	*/
	fetch?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
}

/**
Normalized options passed to the `fetch` call and the `beforeRequest` hooks.
*/
export interface NormalizedOptions extends RequestInit {
	// Extended from `RequestInit`, but ensured to be set (not optional).
	method: RequestInit['method'];
	credentials: RequestInit['credentials'];

	// Extended from custom `KyOptions`, but ensured to be set (not optional).
	retry: RetryOptions;
	prefixUrl: string;
	onDownloadProgress: Options['onDownloadProgress'];
}

/**
Returns a `Response` object with `Body` methods added for convenience. So you can, for example, call `ky.get(input).json()` directly without having to await the `Response` first. When called like that, an appropriate `Accept` header will be set depending on the body method used. Unlike the `Body` methods of `window.Fetch`; these will throw an `HTTPError` if the response status is not in the range of `200...299`. Also, `.json()` will return an empty string if the response status is `204` instead of throwing a parse error due to an empty body.
*/
export interface ResponsePromise extends Promise<Response> {
	arrayBuffer: () => Promise<ArrayBuffer>;

	blob: () => Promise<Blob>;

	formData: () => Promise<FormData>;

	// TODO: Use `json<T extends JSONValue>(): Promise<T>;` when it's fixed in TS.
	// See https://github.com/microsoft/TypeScript/issues/15300 and https://github.com/sindresorhus/ky/pull/80
	/**
	Get the response body as JSON.

	@example
	```
	import ky from 'ky';

	const json = await ky(…).json();
	```

	@example
	```
	import ky from 'ky';

	interface Result {
		value: number;
	}

	const result = await ky(…).json<Result>();
	```
	*/
	json: <T>() => Promise<T>;

	text: () => Promise<string>;
}

/**
Exposed for `instanceof` checks. The error has a `response` property with the [`Response` object](https://developer.mozilla.org/en-US/docs/Web/API/Response), `request` property with the [`Request` object](https://developer.mozilla.org/en-US/docs/Web/API/Request), and `options` property with normalized options (either passed to `ky` when creating an instance with `ky.create()` or directly when performing the request).
*/
declare class HTTPError extends Error {
	constructor(response: Response, request: Request, options: NormalizedOptions);
	response: Response;
	request: Request;
	options: NormalizedOptions;
}

/**
The error thrown when the request times out.
*/
declare class TimeoutError extends Error {
	constructor(request: Request);
	request: Request;
}

declare const ky: {
	/**
	Fetch the given `url`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` method added.

	@example
	```
	import ky from 'ky';

	const json = await ky('https://example.com', {json: {foo: true}}).json();

	console.log(json);
	//=> `{data: '🦄'}`
	```
	*/
	(url: Input, options?: Options): ResponsePromise;

	/**
	Fetch the given `url` using the option `{method: 'get'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	get: (url: Input, options?: Options) => ResponsePromise;

	/**
	Fetch the given `url` using the option `{method: 'post'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	post: (url: Input, options?: Options) => ResponsePromise;

	/**
	Fetch the given `url` using the option `{method: 'put'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	put: (url: Input, options?: Options) => ResponsePromise;

	/**
	Fetch the given `url` using the option `{method: 'delete'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	delete: (url: Input, options?: Options) => ResponsePromise;

	/**
	Fetch the given `url` using the option `{method: 'patch'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	patch: (url: Input, options?: Options) => ResponsePromise;

	/**
	Fetch the given `url` using the option `{method: 'head'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	head: (url: Input, options?: Options) => ResponsePromise;

	/**
	Create a new Ky instance with complete new defaults.

	@returns A new Ky instance.
	*/
	create: (defaultOptions: Options) => typeof ky;

	/**
	Create a new Ky instance with some defaults overridden with your own.

	In contrast to `ky.create()`, `ky.extend()` inherits defaults from its parent.

	@returns A new Ky instance.
	*/
	extend: (defaultOptions: Options) => typeof ky;

	/**
	A `Symbol` that can be returned by a `beforeRetry` hook to stop the retry. This will also short circuit the remaining `beforeRetry` hooks.

	Note: Returning this symbol makes Ky abort and return with an `undefined` response. Be sure to check for a response before accessing any properties on it or use [optional chaining](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining). It is also incompatible with body methods, such as `.json()` or `.text()`, because there is no response to parse. In general, we recommend throwing an error instead of returning this symbol, as that will cause Ky to abort and then throw, which avoids these limitations.

	A valid use-case for `ky.stop` is to prevent retries when making requests for side effects, where the returned data is not important. For example, logging client activity to the server.

	@example
	```
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

	// Note that response will be `undefined` in case `ky.stop` is returned.
	const response = await ky.post('https://example.com', options);

	// Using `.text()` or other body methods is not suppported.
	const text = await ky('https://example.com', options).text();
	```
	*/
	readonly stop: unique symbol;
	readonly TimeoutError: typeof TimeoutError;
	readonly HTTPError: typeof HTTPError;
};

declare namespace ky {
	export type TimeoutError = InstanceType<typeof TimeoutError>;
	export type HTTPError = InstanceType<typeof HTTPError>;
}

export default ky;
