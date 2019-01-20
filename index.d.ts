type JSONObject = {[key: string]: JSONValue};
interface JSONArray extends Array<JSONValue> {}
export type JSONValue = string | number | boolean | null | JSONObject | JSONArray;

export type JSONStringifyable = string | number | boolean | null | object;

export type BeforeRequestHook = (options: Options) => void;

export type AfterResponseHook = (response: Response) => Response | void;

export interface Hooks {
	/**
	 * Before the request is sent.
	 *
	 * This hook enables you to modify the request right before it is sent. Ky will make no further changes to the request after this. The hook function receives the normalized options as the first argument. You could, for example, modify `options.headers` here.
	 *
	 * @default []
	 */
	beforeRequest?: BeforeRequestHook[];

	/**
	 * After the response is received.
	 *
	 * This hook enables you to read and optionally modify the response. The return value of the hook function will be used by Ky as the response object if it's an instance of [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response).
	 *
	 * @default []
	 */
	afterResponse?: AfterResponseHook[];
}

/**
 * Options are the same as fetch, with some exceptions.
 */
export interface Options extends RequestInit {
	/**
	 * Shortcut for sending JSON. Use this instead of the `body` option.
	 */
	json?: JSONStringifyable;

	/**
	* Search parameters to include in the request URL.
	* Setting this will override all existing search parameters in the input URL.
	*/
	searchParams?: string | {[key: string]: string | number} | URLSearchParams;

	/**
	* Prepends the input with the specified prefix.
	* The prefix can be any valid URL, either relative or absolute.
	*/
	prefixUrl?: URL | string;

	/**
	 * Numer of times to retry failed requests.
	 *
	 * @default 2
	 */
	retry?: number;

	/**
	 * Timeout in milliseconds for getting a response.
	 *
	 * @default 10000
	 */
	timeout?: number;

	/**
	 * Hooks allow modifications during the request lifecycle. Hook functions may be async and are run serially.
	 */
	hooks?: Hooks;

	/**
	 * Throw a `HTTPError` for error responses (non-2xx status codes).
	 *
	 * @default true
	 */
	throwHttpErrors?: boolean;
}

/**
 * Returns a `Response` object with `Body` methods added for convenience.
 */
export interface ResponsePromise extends Promise<Response> {
	arrayBuffer(): Promise<ArrayBuffer>;
	blob(): Promise<Blob>;
	formData(): Promise<FormData>;
	json(): Promise<JSONValue>;
	text(): Promise<string>;
}

/**
 * The error has a response property with the `Response` object.
 */
export class HTTPError extends Error {
	response: Response;
}

/**
 * The error thrown when the request times out.
 */
export class TimeoutError extends Error {}

export interface Ky {
	/**
	 * Fetches the `input` URL.
	 *
	 * @param input - `Request` object, `URL` object, or URL string.
	 * @returns Promise with `Body` method added.
	 */
	(input: Request | URL | string, options?: Options): ResponsePromise;

	/**
	 * Fetches the `input` URL with the option `{method: 'get'}`.
	 *
	 * @param input - `Request` object, `URL` object, or URL string.
	 * @returns Promise with `Body` method added.
	 */
	get(input: Request | URL | string, options?: Options): ResponsePromise;

	/**
	 * Fetches the `input` URL with the option `{method: 'post'}`.
	 *
	 * @param input - `Request` object, `URL` object, or URL string.
	 * @returns Promise with `Body` method added.
	 */
	post(input: Request | URL | string, options?: Options): ResponsePromise;

	/**
	 * Fetches the `input` URL with the option `{method: 'put'}`.
	 *
	 * @param input - `Request` object, `URL` object, or URL string.
	 * @returns Promise with `Body` method added.
	 */
	put(input: Request | URL | string, options?: Options): ResponsePromise;

	/**
	 * Fetches the `input` URL with the option `{method: 'patch'}`.
	 *
	 * @param input - `Request` object, `URL` object, or URL string.
	 * @returns Promise with `Body` method added.
	 */
	patch(input: Request | URL | string, options?: Options): ResponsePromise;

	/**
	 * Fetches the `input` URL with the option `{method: 'head'}`.
	 *
	 * @param input - `Request` object, `URL` object, or URL string.
	 * @returns Promise with `Body` method added.
	 */
	head(input: Request | URL | string, options?: Options): ResponsePromise;

	/**
	 * Fetches the `input` URL with the option `{method: 'delete'}`.
	 *
	 * @param input - `Request` object, `URL` object, or URL string.
	 * @returns Promise with `Body` method added.
	 */
	delete(input: Request | URL | string, options?: Options): ResponsePromise;

	/**
	 * Create a new Ky instance with some defaults overridden with your own.
	 *
	 * @returns New Ky instance
	 */
	extend(defaultOptions: Options): Ky;
}

declare const ky: Ky;

export default ky;
