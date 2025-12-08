import type {Expect, Equal} from '@type-challenges/utils';
import {type HttpMethod, type KyOptionsRegistry} from '../types/options.js';

export const supportsRequestStreams = (() => {
	let duplexAccessed = false;
	let hasContentType = false;
	const supportsReadableStream = typeof globalThis.ReadableStream === 'function';
	const supportsRequest = typeof globalThis.Request === 'function';

	if (supportsReadableStream && supportsRequest) {
		try {
			hasContentType = new globalThis.Request('https://empty.invalid', {
				body: new globalThis.ReadableStream(),
				method: 'POST',
				// @ts-expect-error - Types are outdated.
				get duplex() {
					duplexAccessed = true;
					return 'half';
				},
			}).headers.has('Content-Type');
		} catch (error) {
			// QQBrowser on iOS throws "unsupported BodyInit type" error (see issue #581)
			if (error instanceof Error && error.message === 'unsupported BodyInit type') {
				return false;
			}

			throw error;
		}
	}

	return duplexAccessed && !hasContentType;
})();

export const supportsAbortController = typeof globalThis.AbortController === 'function';
export const supportsAbortSignal = typeof globalThis.AbortSignal === 'function' && typeof globalThis.AbortSignal.any === 'function';
export const supportsResponseStreams = typeof globalThis.ReadableStream === 'function';
export const supportsFormData = typeof globalThis.FormData === 'function';

export const requestMethods = ['get', 'post', 'put', 'patch', 'head', 'delete'] as const;

const validate = <T extends Array<true>>() => undefined as unknown as T;
validate<[
	Expect<Equal<typeof requestMethods[number], HttpMethod>>,
]>();

export const responseTypes = {
	json: 'application/json',
	text: 'text/*',
	formData: 'multipart/form-data',
	arrayBuffer: '*/*',
	blob: '*/*',
	// Supported in modern Fetch implementations (for example, browsers and recent Node.js/undici).
	// We still feature-check at runtime before exposing the shortcut.
	bytes: '*/*',
} as const;

// The maximum value of a 32bit int (see issue #117)
export const maxSafeTimeout = 2_147_483_647;

// Size in bytes of a typical form boundary, used to help estimate upload size
export const usualFormBoundarySize = new TextEncoder().encode('------WebKitFormBoundaryaxpyiPgbbPti10Rw').length;

export const stop = Symbol('stop');

/**
Options for forcing a retry via `ky.retry()`.
*/
export type ForceRetryOptions = {
	/**
	Custom delay in milliseconds before retrying.

	If not provided, uses the default retry delay calculation based on `retry.delay` configuration.

	**Note:** Custom delays bypass jitter and `backoffLimit`. This is intentional, as custom delays often come from server responses (e.g., `Retry-After` headers) and should be respected exactly as specified.
	*/
	delay?: number;

	/**
	Error code for the retry.

	This machine-readable identifier will be included in the error message passed to `beforeRetry` hooks, allowing you to distinguish between different types of forced retries.

	@example
	```
	return ky.retry({code: 'RATE_LIMIT'});
	// Resulting error message: 'Forced retry: RATE_LIMIT'
	```
	*/
	code?: string;

	/**
	Original error that caused the retry.

	This allows you to preserve the error chain when forcing a retry based on caught exceptions. The error will be set as the `cause` of the `ForceRetryError`, enabling proper error chain traversal.

	@example
	```
	try {
		const data = await response.clone().json();
		validateBusinessLogic(data);
	} catch (error) {
		return ky.retry({
			code: 'VALIDATION_FAILED',
			cause: error  // Preserves original error in chain
		});
	}
	```
	*/
	cause?: Error;

	/**
	Custom request to use for the retry.

	This allows you to modify or completely replace the request during a forced retry. The custom request becomes the starting point for the retry - `beforeRetry` hooks can still further modify it if needed.

	**Note:** The custom request's `signal` will be replaced with Ky's managed signal to handle timeouts and user-provided abort signals correctly. If the original request body has been consumed, you must provide a new body or clone the request before consuming.

	@example
	```
	// Fallback to a different endpoint
	return ky.retry({
		request: new Request('https://backup-api.com/endpoint', {
			method: request.method,
			headers: request.headers,
		}),
		code: 'BACKUP_ENDPOINT'
	});

	// Retry with refreshed authentication token
	const data = await response.clone().json();
	return ky.retry({
		request: new Request(request, {
			headers: {
				...Object.fromEntries(request.headers),
				'Authorization': `Bearer ${data.newToken}`
			}
		}),
		code: 'TOKEN_REFRESHED'
	});
	```
	*/
	request?: Request;
};

/**
Marker returned by ky.retry() to signal a forced retry from afterResponse hooks.
*/
export class RetryMarker {
	constructor(public options?: ForceRetryOptions) {}
}

/**
Force a retry from an `afterResponse` hook.

This allows you to retry a request based on the response content, even if the response has a successful status code. The retry will respect the `retry.limit` option and skip the `shouldRetry` check. The forced retry is observable in `beforeRetry` hooks, where the error will be a `ForceRetryError`.

@param options - Optional configuration for the retry.

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
							code: 'RATE_LIMIT'
						});
					}

					// Retry with a modified request (e.g., fallback endpoint)
					if (data.error?.code === 'FALLBACK_TO_BACKUP') {
						return ky.retry({
							request: new Request('https://backup-api.com/endpoint', {
								method: request.method,
								headers: request.headers,
							}),
							code: 'BACKUP_ENDPOINT'
						});
					}

					// Retry with refreshed authentication
					if (data.error?.code === 'TOKEN_REFRESH' && data.newToken) {
						return ky.retry({
							request: new Request(request, {
								headers: {
									...Object.fromEntries(request.headers),
									'Authorization': `Bearer ${data.newToken}`
								}
							}),
							code: 'TOKEN_REFRESHED'
						});
					}

					// Retry with cause to preserve error chain
					try {
						validateResponse(data);
					} catch (error) {
						return ky.retry({
							code: 'VALIDATION_FAILED',
							cause: error
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
export const retry = (options?: ForceRetryOptions) => new RetryMarker(options);

export const kyOptionKeys: KyOptionsRegistry = {
	bearer: true,
	json: true,
	parseJson: true,
	stringifyJson: true,
	searchParams: true,
	prefixUrl: true,
	retry: true,
	timeout: true,
	hooks: true,
	throwHttpErrors: true,
	onDownloadProgress: true,
	onUploadProgress: true,
	fetch: true,
	context: true,
};

// Vendor-specific fetch options that should always be passed to fetch()
// even if they appear on the Request object due to vendor patching.
// See: https://github.com/sindresorhus/ky/issues/541
export const vendorSpecificOptions = {
	next: true, // Next.js cache revalidation (revalidate, tags)
} as const;

// Standard RequestInit options that should NOT be passed separately to fetch()
// because they're already applied to the Request object.
// Note: `dispatcher` and `priority` are NOT included here - they're fetch-only
// options that the Request constructor doesn't accept, so they need to be passed
// separately to fetch().
export const requestOptionsRegistry = {
	method: true,
	headers: true,
	body: true,
	mode: true,
	credentials: true,
	cache: true,
	redirect: true,
	referrer: true,
	referrerPolicy: true,
	integrity: true,
	keepalive: true,
	signal: true,
	window: true,
	duplex: true,
} as const;
