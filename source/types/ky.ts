import {type stop, type retry} from '../core/constants.js';
import type {Input, Options} from './options.js';
import type {ResponsePromise} from './ResponsePromise.js';

export type KyInstance = {
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
	<T>(url: Input, options?: Options): ResponsePromise<T>;

	/**
	Fetch the given `url` using the option `{method: 'get'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	get: <T>(url: Input, options?: Options) => ResponsePromise<T>;

	/**
	Fetch the given `url` using the option `{method: 'post'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	post: <T>(url: Input, options?: Options) => ResponsePromise<T>;

	/**
	Fetch the given `url` using the option `{method: 'put'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	put: <T>(url: Input, options?: Options) => ResponsePromise<T>;

	/**
	Fetch the given `url` using the option `{method: 'delete'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	delete: <T>(url: Input, options?: Options) => ResponsePromise<T>;

	/**
	Fetch the given `url` using the option `{method: 'patch'}`.

	@param url - `Request` object, `URL` object, or URL string.
	@returns A promise with `Body` methods added.
	*/
	patch: <T>(url: Input, options?: Options) => ResponsePromise<T>;

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
	create: (defaultOptions?: Options) => KyInstance;

	/**
	Create a new Ky instance with some defaults overridden with your own.

	In contrast to `ky.create()`, `ky.extend()` inherits defaults from its parent.

	You can also refer to parent defaults by providing a function to `.extend()`.

	@example
	```
	import ky from 'ky';

	const api = ky.create({prefixUrl: 'https://example.com/api'});

	const usersApi = api.extend((options) => ({prefixUrl: `${options.prefixUrl}/users`}));

	const response = await usersApi.get('123');
	//=> 'https://example.com/api/users/123'

	const response = await api.get('version');
	//=> 'https://example.com/api/version'
	```

	@returns A new Ky instance.
	*/
	extend: (defaultOptions: Options | ((parentOptions: Options) => Options)) => KyInstance;

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

	// Using `.text()` or other body methods is not supported.
	const text = await ky('https://example.com', options).text();
	```
	*/
	readonly stop: typeof stop;

	/**
	Force a retry from an `afterResponse` hook.

	This allows you to retry a request based on the response content, even if the response has a successful status code. The retry will respect the `retry.limit` option and skip the `shouldRetry` check. The forced retry is observable in `beforeRetry` hooks, where the error will be a `ForceRetryError`.

	@example
	```
	import ky, {isForceRetryError} from 'ky';

	const api = ky.extend({
		hooks: {
			afterResponse: [
				async (request, options, response) => {
					// Retry based on response body content
					if (response.status === 200) {
						const data = await response.clone().json();

						// Simple retry with default delay
						if (data.error?.code === 'TEMPORARY_ERROR') {
							return ky.retry();
						}

						// Retry with custom delay from API response
						if (data.error?.code === 'RATE_LIMIT') {
							return ky.retry({
								delay: data.error.retryAfter * 1000,
								reason: 'RATE_LIMIT'
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
	*/
	readonly retry: typeof retry;
};
