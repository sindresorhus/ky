/// <reference lib="dom"/>

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

type JSONObject = {[key: string]: JSONValue};
interface JSONArray extends Array<JSONValue> {}
export type JSONValue = string | number | boolean | null | JSONObject | JSONArray;

export type JSONStringifyable = string | number | boolean | null | object;

export type BeforeRequestHook = (options: Options) => void | Promise<void>;

export type AfterResponseHook = (response: Response) => Response | void | Promise<Response | void>;

export interface Hooks {
	/**
	Before the request is sent.

	This hook enables you to modify the request right before it is sent. Ky will make no further changes to the request after this. The hook function receives the normalized options as the first argument. You could, for example, modify `options.headers` here.

	@default []
	*/
	beforeRequest?: BeforeRequestHook[];

	/**
	After the response is received.

	This hook enables you to read and optionally modify the response. The return value of the hook function will be used by Ky as the response object if it's an instance of [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response).

	@default []
	*/
	afterResponse?: AfterResponseHook[];
}

/**
Options are the same as `window.fetch`, with some exceptions.
*/
export interface Options extends RequestInit {
	/**
	Shortcut for sending JSON. Use this instead of the `body` option.
	*/
	json?: JSONStringifyable;

	/**
	Search parameters to include in the request URL.
	Setting this will override all existing search parameters in the input URL.
	*/
	searchParams?: string | {[key: string]: string | number} | URLSearchParams;

	/**
	Prepends the input URL with the specified prefix.
	The prefix can be any valid URL, either relative or absolute.
	*/
	prefixUrl?: URL | string;

	/**
	Numer of times to retry failed requests.

	@default 2
	*/
	retry?: number;

	/**
	Timeout in milliseconds for getting a response. Can not be greater than 2147483647.
	If set to `false`, there will be no timeout.

	@default 10000
	*/
	timeout?: number | false;

	/**
	Download progress event handler.

	If it's not possible to retrieve the body size, `totalBytes` will be `0`.
	*/
	onDownloadProgress?: (percent: number, transferredBytes: number, totalBytes: number, chunk?: Uint8Array) => void;

	/**
	Hooks allow modifications during the request lifecycle. Hook functions may be async and are run serially.
	*/
	hooks?: Hooks;

	/**
	Throw a `HTTPError` for error responses (non-2xx status codes).

	@default true
	*/
	throwHttpErrors?: boolean;
}

interface OptionsWithoutBody extends Omit<Options, 'body'> {
	method?: 'get' | 'head'
}

interface OptionsWithBody extends Options {
	method?: 'post' | 'put' | 'delete'
}

/**
Returns a `Response` object with `Body` methods added for convenience.
*/
export interface ResponsePromise extends Promise<Response> {
	arrayBuffer(): Promise<ArrayBuffer>;

	blob(): Promise<Blob>;

	formData(): Promise<FormData>;

	// TODO: Use `json<T extends JSONValue>(): Promise<T>;` when it's fixed in TS.
	// See https://github.com/sindresorhus/ky/pull/80
	/**
	Get the response body as JSON.

	@example
	```
	import ky from 'ky';

	const parsed = await ky(…).json();
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
	json<T = JSONValue>(): Promise<T>;

	text(): Promise<string>;
}

/**
The error has a response property with the `Response` object.
*/
export class HTTPError extends Error {
	constructor(response: Response);
	response: Response;
}

/**
The error thrown when the request times out.
*/
export class TimeoutError extends Error {
	constructor();
}

declare const ky: {
	/**
	Fetch the given `url`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` method added.

	@example
	```
	import ky from 'ky';

	(async () => {
		const parsed = await ky('https://example.com', {json: {foo: true}}).json();

		console.log(parsed);
		//=> `{data: '🦄'}`
	})();
	```
	*/
	(url: Request | URL | string, options?: OptionsWithoutBody | OptionsWithBody): ResponsePromise;

	/**
	Fetch the given `url` using the option `{method: 'get'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	get(url: Request | URL | string, options?: Omit<Options, 'body'>): ResponsePromise;

	/**
	Fetch the given `url` using the option `{method: 'post'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	post(url: Request | URL | string, options?: Options): ResponsePromise;

	/**
	Fetch the given `url` using the option `{method: 'put'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	put(url: Request | URL | string, options?: Options): ResponsePromise;

	/**
	Fetch the given `url` using the option `{method: 'patch'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	patch(url: Request | URL | string, options?: Options): ResponsePromise;

	/**
	Fetch the given `url` using the option `{method: 'head'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	head(url: Request | URL | string, options?: Omit<Options, 'body'>): ResponsePromise;

	/**
	Fetch the given `url` using the option `{method: 'delete'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	delete(url: Request | URL | string, options?: Options): ResponsePromise;

	/**
	Create a new Ky instance with some defaults overridden with your own.

	@returns A new Ky instance.
	*/
	extend(defaultOptions: Options): typeof ky;
}

export default ky;
