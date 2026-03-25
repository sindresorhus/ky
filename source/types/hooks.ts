import {type stop, type RetryMarker} from '../core/constants.js';
import type {KyRequest, KyResponse} from '../index.js';
import type {NormalizedOptions, Options} from './options.js';

/**
This hook enables you to modify the options before they are used to construct the request. The hook function receives the mutable options object and can modify it in place. You could, for example, modify `searchParams`, `headers`, or `json` here.

Unlike other hooks, `init` hooks are synchronous. Any error thrown will propagate synchronously and will not be caught by `beforeError` hooks.

@example
```
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
*/
export type InitHook = (options: Options) => void;

export type BeforeRequestState = {
	request: KyRequest;
	options: NormalizedOptions;

	/**
	The number of retries attempted. Always `0`, since `beforeRequest` hooks run once before retry handling begins.
	*/
	retryCount: 0;
};

export type BeforeRequestHook = (state: BeforeRequestState) => Request | Response | void | Promise<Request | Response | void>;

export type BeforeRetryState = {
	request: KyRequest;
	options: NormalizedOptions;
	error: Error;

	/**
	The number of retries attempted. Always `>= 1`, since this hook is only called during retries, not on the initial request.
	*/
	retryCount: number;
};

export type BeforeRetryHook = (state: BeforeRetryState) => Request | Response | typeof stop | void | Promise<Request | Response | typeof stop | void>;

export type BeforeErrorState = {
	request: KyRequest;
	options: NormalizedOptions;

	// `Error` (not `KyError`) because this receives all errors, including non-Ky ones.
	error: Error;

	/**
	The number of retries attempted. `0` for the initial request, increments with each retry.

	This allows you to distinguish between the initial request and retries, which is useful when you need different error handling based on retry attempts (e.g., showing different error messages on the final attempt).
	*/
	retryCount: number;
};

// Returns `Error` to allow replacing Ky errors with custom non-Ky error types.
export type BeforeErrorHook = (state: BeforeErrorState) => Error | Promise<Error>;

export type AfterResponseState = {
	request: KyRequest;
	options: NormalizedOptions;
	response: KyResponse;

	/**
	The number of retries attempted. `0` for the initial request, increments with each retry.

	This allows you to distinguish between the initial request and retries, which is useful when you need different behavior for retries (e.g., showing a notification only on the final retry).
	*/
	retryCount: number;
};

export type AfterResponseHook = (state: AfterResponseState) => Response | RetryMarker | void | Promise<Response | RetryMarker | void>;

export type Hooks = {
	/**
	This hook enables you to modify the options before they are used to construct the request. The hook function receives the mutable options object and can modify it in place. You could, for example, modify `searchParams`, `headers`, or `json` here.

	Unlike other hooks, `init` hooks are synchronous. Any error thrown will propagate synchronously and will not be caught by `beforeError` hooks.

	A common use case is to add a search parameter to every request:

	@example
	```
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

	@default []
	*/
	init?: InitHook[];

	/**
	This hook enables you to modify the request right before it is sent. Ky will make no further changes to the request after this. The hook function receives a state object with the normalized request, options, and retry count. You could, for example, modify `request.headers` here.

	The `retryCount` is always `0`, since `beforeRequest` hooks run once before retry handling begins.

	The hook can return a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) to replace the outgoing request (remaining hooks will still run with the updated request). It can also return a [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) to completely avoid making an HTTP request, in which case remaining `beforeRequest` hooks are skipped. This can be used to mock a request, check an internal cache, etc.

	Any error thrown by `beforeRequest` hooks is treated as fatal and will not trigger Ky's retry logic.

	@example
	```
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

	@example
	```
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

	@default []
	*/
	beforeRequest?: BeforeRequestHook[];

	/**
	This hook enables you to modify the request right before retry. Ky will make no further changes to the request after this. The hook function receives a state object with the normalized request, options, an error instance, and retry count. You could, for example, modify `request.headers` here.

	The hook can return a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) to replace the outgoing retry request, or return a [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) to skip the retry and use that response instead. **Note:** Returning a request or response skips remaining `beforeRetry` hooks.

	The `retryCount` is always `>= 1`, since this hook is only called during retries, not on the initial request.

	If the request received a response, the error will be of type `HTTPError`. The `Response` object will be available at `error.response`, and the pre-parsed response body will be available at `error.data`. Be aware that some types of errors, such as network errors, inherently mean that a response was not received. In that case, the error will be an instance of `NetworkError` instead of `HTTPError`.

	You can prevent Ky from retrying the request by throwing an error. Ky will not handle it in any way and the error will be propagated to the request initiator. The rest of the `beforeRetry` hooks will not be called in this case. Alternatively, you can return the [`ky.stop`](#kystop) symbol to do the same thing but without propagating an error (this has some limitations, see `ky.stop` docs for details).

	**Modifying headers:**

	@example
	```
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

	@example
	```
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

	@example
	```
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

	@default []
	*/
	beforeRetry?: BeforeRetryHook[];

	/**
	This hook enables you to modify any error right before it is thrown. The hook function receives a state object with the normalized request, options, error, and retry count, and should return an `Error` instance.

	This hook is called for all error types, including `HTTPError`, `NetworkError`, `TimeoutError`, and `ForceRetryError` (when retry limit is exceeded via `ky.retry()`). Use type guards like `isHTTPError()`, `isNetworkError()`, or `isTimeoutError()` to handle specific error types.

	The `retryCount` is `0` for the initial request and increments with each retry. This allows you to distinguish between the initial request and retries, which is useful when you need different error handling based on retry attempts (e.g., showing different error messages on the final attempt).

	@default []

	@example
	```
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
	*/
	beforeError?: BeforeErrorHook[];

	/**
	This hook enables you to read and optionally modify the response. The hook function receives a state object with the normalized request, options, a clone of the response, and retry count. The return value of the hook function will be used by Ky as the response object if it's an instance of [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response).

	You can also force a retry by returning [`ky.retry(options)`](#kyretryoptions). This is useful when you need to retry based on the response body content, even if the response has a successful status code. The retry will respect the `retry.limit` option and be observable in `beforeRetry` hooks.

	Any non-`ky.retry()` error thrown by `afterResponse` hooks is treated as fatal and will not trigger Ky's retry logic.

	The `retryCount` is `0` for the initial request and increments with each retry. This allows you to distinguish between the initial request and retries, which is useful when you need different behavior for retries (e.g., showing a notification only on the final retry).

	@default []

	@example
	```
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
						const data = await response.clone().json();
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
	*/
	afterResponse?: AfterResponseHook[];
};
