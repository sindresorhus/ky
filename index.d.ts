export type BeforeRequestHook = (options: Object) => void;

export interface Hooks {
	/**
	 * Before the request is sent.
	 *
	 * @default []
	 */
	beforeRequest: BeforeRequestHook[];
}

/**
 * Options are the same as fetch, with some exceptions.
 */
export interface Options extends RequestInit {
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
	 * Shortcut for sending JSON. Use this instead of the `body` option.
	 */
	json?: object;

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
	json(): Promise<unknown>;
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
	 * Same as fetch.
	 *
	 * @param input - Request object or URL string.
	 * @returns Promise with `Body` method added.
	 */
	(input: Request | string, options?: Options): ResponsePromise;

	/**
	 * Same as fetch's `get()` method.
	 *
	 * @param input - Request object or URL string.
	 * @returns Promise with `Body` method added.
	 */
	get(input: Request | string, options?: Options): ResponsePromise;

	/**
	 * Same as fetch's `post()` method.
	 *
	 * @param input - Request object or URL string.
	 * @returns Promise with `Body` method added.
	 */
	post(input: Request | string, options?: Options): ResponsePromise;

	/**
	 * Same as fetch's `put()` method.
	 *
	 * @param input - Request object or URL string.
	 * @returns Promise with `Body` method added.
	 */
	put(input: Request | string, options?: Options): ResponsePromise;

	/**
	 * Same as fetch's `patch()` method.
	 *
	 * @param input - Request object or URL string.
	 * @returns Promise with `Body` method added.
	 */
	patch(input: Request | string, options?: Options): ResponsePromise;

	/**
	 * Same as fetch's `head()` method.
	 *
	 * @param input - Request object or URL string.
	 * @returns Promise with `Body` method added.
	 */
	head(input: Request | string, options?: Options): ResponsePromise;

	/**
	 * Same as fetch's `delete()` method.
	 *
	 * @param input - Request object or URL string.
	 * @returns Promise with `Body` method added.
	 */
	delete(input: Request | string, options?: Options): ResponsePromise;

	/**
	 * Create a new Ky instance with some defaults overridden with your own.
	 *
	 * @returns New Ky instance
	 */
	extend(defaultOptions: Options): Ky;
}

declare const ky: Ky;

export default ky;
