import { IPromise } from '.';
/**
 * options are the same as fetch, with some exceptions.
 */
interface Options extends RequestInit {
	/**
	 * Retry failed requests times.
	 * @default 2
	 */
	retry?: number;
	/**
	 * Timeout in milliseconds for getting a response.
	 * @default 10000
	 */
	timeout?: number;
	/**
	 * Shortcut for sending JSON. Use this instead of the body option.
	 */
	json?: object;
}

/**
 * Returns a Response object with Body methods added for convenience.
 */
export interface IPromise extends Promise<Response> {
	arrayBuffer(): Promise<ArrayBuffer>;
	blob(): Promise<Blob>;
	formData(): Promise<FormData>;
	json(): Promise<any>;
	text(): Promise<string>;
}

/**
 * The error has a response property with the Response object.
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
	 * same as fetch.
	 * @param input - Request object or url string.
	 * @returns Promise with Body method added.
	 */
	(input: Request | string, options?: Options): IPromise;

	/**
	 * same as fetch's get method.
	 * @param input - Request object or url string.
	 * @returns Promise with Body method added.
	 */
	get(input: Request | string, options?: Options): IPromise;

	/**
	 * same as fetch's post method.
	 * @param input - Request object or url string.
	 * @returns Promise with Body method added.
	 */
	post(input: Request | string, options?: Options): IPromise;

	/**
	 * same as fetch's put method.
	 * @param input - Request object or url string.
	 * @returns Promise with Body method added.
	 */
	put(input: Request | string, options?: Options): IPromise;

	/**
	 * same as fetch's patch method.
	 * @param input - Request object or url string.
	 * @returns Promise with Body method added.
	 */
	patch(input: Request | string, options?: Options): IPromise;

	/**
	 * same as fetch's head method.
	 * @param input - Request object or url string.
	 * @returns Promise with Body method added.
	 */
	head(input: Request | string, options?: Options): IPromise;

	/**
	 * same as fetch's delete method.
	 * @param input - Request object or url string.
	 * @returns Promise with Body method added.
	 */
	delete(input: Request | string, options?: Options): IPromise;

	/**
	 * Create a new ky instance with some defaults overridden with your own.
	 * @returns new Ky instance
	 */
	extend(defaultOptions: Options): Ky;

	/**
	 * The error has a response property with the Response object.
	 */
	HTTPError: HTTPError;

	/**
	 * The error thrown when the request times out.
	 */
	TimeoutError: TimeoutError;
}

declare const ky: Ky;

export default ky;
