import {stop} from '../core/constants.js';
import {HTTPError} from '../index.js';
import type {NormalizedOptions} from './options.js';

export type BeforeRequestHook = (
	request: Request,
	options: NormalizedOptions
) => Request | Response | void | Promise<Request | Response | void>;

export type BeforeRetryState = {
	request: Request;
	options: NormalizedOptions;
	error: Error;
	retryCount: number;
};
export type BeforeRetryHook = (options: BeforeRetryState) => typeof stop | void | Promise<typeof stop | void>;

export type AfterResponseHook = (
	request: Request,
	options: NormalizedOptions,
	response: Response
) => Response | void | Promise<Response | void>;

export type BeforeErrorHook = (error: HTTPError) => HTTPError | Promise<HTTPError>;

export interface Hooks {
	/**
	This hook enables you to modify the request right before it is sent. Ky will make no further changes to the request after this. The hook function receives normalized input and options as arguments. You could, forf example, modiy `options.headers` here.

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

	/**
	This hook enables you to modify the `HTTPError` right before it is thrown. The hook function receives a `HTTPError` as an argument and should return an instance of `HTTPError`.

	@default []

	@example
	```
	import ky from 'ky';

	await ky('https://example.com', {
		hooks: {
			beforeError: [
				error => {
					const {response} = error;
					if (response && response.body) {
						error.name = 'GitHubError';
						error.message = `${response.body.message} (${response.statusCode})`;
					}

					return error;
				}
			]
		}
	});
	```
	*/
	beforeError?: BeforeErrorHook[];
}
