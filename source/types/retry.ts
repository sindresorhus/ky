export type ShouldRetryState = {
	/**
	The error that caused the request to fail.
	*/
	error: Error;

	/**
	The number of retries attempted. Starts at 1 for the first retry.
	*/
	retryCount: number;
};

export type RetryOptions = {
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

	/**
	The upper limit of the delay per retry in milliseconds.
	To clamp the delay, set `backoffLimit` to 1000, for example.

	By default, the delay is calculated in the following way:

	```
	0.3 * (2 ** (attemptCount - 1)) * 1000
	```

	The delay increases exponentially.

	@default Infinity
	*/
	backoffLimit?: number;

	/**
	A function to calculate the delay between retries given `attemptCount` (starts from 1).

	@default attemptCount => 0.3 * (2 ** (attemptCount - 1)) * 1000
	*/
	delay?: (attemptCount: number) => number;

	/**
	Add random jitter to retry delays to prevent thundering herd problems.

	When many clients retry simultaneously (e.g., after hitting a rate limit), they can overwhelm the server again. Jitter adds randomness to break this synchronization.

	Set to `true` to use full jitter, which randomizes the delay between 0 and the computed delay.

	Alternatively, pass a function to implement custom jitter strategies.

	@default undefined (no jitter)

	@example
	```
	import ky from 'ky';

	const json = await ky('https://example.com', {
		retry: {
			limit: 5,

			// Full jitter (randomizes delay between 0 and computed value)
			jitter: true

			// Percentage jitter (80-120% of delay)
			// jitter: delay => delay * (0.8 + Math.random() * 0.4)

			// Absolute jitter (±100ms)
			// jitter: delay => delay + (Math.random() * 200 - 100)
		}
	}).json();
	```
	*/
	jitter?: boolean | ((delay: number) => number) | undefined;

	/**
	Whether to retry when the request times out.

	@default false

	@example
	```
	import ky from 'ky';

	const json = await ky('https://example.com', {
		retry: {
			limit: 3,
			retryOnTimeout: true
		}
	}).json();
	```
	*/
	retryOnTimeout?: boolean;

	/**
	A function to determine whether a retry should be attempted.

	This function takes precedence over all other retry checks and is called first, before any other retry validation.

	**Note:** This is different from the `beforeRetry` hook:
	- `shouldRetry`: Controls WHETHER to retry (called before the retry decision is made)
	- `beforeRetry`: Called AFTER retry is confirmed, allowing you to modify the request

	Should return:
	- `true` to force a retry (bypasses `retryOnTimeout`, status code checks, and other validations)
	- `false` to prevent a retry (no retry will occur)
	- `undefined` to use the default retry logic (`retryOnTimeout`, status codes, etc.)

	@example
	```
	import ky, {HTTPError} from 'ky';

	const json = await ky('https://example.com', {
		retry: {
			limit: 3,
			shouldRetry: ({error, retryCount}) => {
				// Retry on specific business logic errors from API
				if (error instanceof HTTPError) {
					const status = error.response.status;

					// Retry on 429 (rate limit) but only for first 2 attempts
					if (status === 429 && retryCount <= 2) {
						return true;
					}

					// Don't retry on 4xx errors except rate limits
					if (status >= 400 && status < 500) {
						return false;
					}
				}

				// Use default retry logic for other errors
				return undefined;
			}
		}
	}).json();
	```
	*/
	shouldRetry?: (state: ShouldRetryState) => boolean | undefined | Promise<boolean | undefined>;
};
