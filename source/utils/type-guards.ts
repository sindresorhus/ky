import type {KyError} from '../errors/KyError.js';
import {HTTPError} from '../errors/HTTPError.js';
import {NetworkError} from '../errors/NetworkError.js';
import {TimeoutError} from '../errors/TimeoutError.js';
import {ForceRetryError} from '../errors/ForceRetryError.js';

// Handles cross-realm cases (e.g., iframes, different JS contexts) where `instanceof` fails.
const isErrorType = (error: unknown, cls: {name: string}): boolean =>
	error instanceof (cls as any) || (error as any)?.name === cls.name;

/**
Type guard to check if an error is a `KyError`.

Note: `SchemaValidationError` is intentionally not considered a Ky error. `KyError` covers failures in Ky's HTTP lifecycle (bad status, timeout, retry), while schema validation errors originate from the user-provided schema, not from Ky itself.

@param error - The error to check
@returns `true` if the error is a Ky error, `false` otherwise

@example
```
import ky, {isKyError} from 'ky';
try {
	const response = await ky.get('/api/data');
} catch (error) {
	if (isKyError(error)) {
		// Handle Ky-specific errors
		console.log('Ky error occurred:', error.message);
	} else {
		// Handle other errors
		console.log('Unknown error:', error);
	}
}
```
*/
export function isKyError(error: unknown): error is KyError {
	return (error as any)?.isKyError === true || isHTTPError(error) || isNetworkError(error) || isTimeoutError(error) || isForceRetryError(error);
}

/**
Type guard to check if an error is an `HTTPError`.

@param error - The error to check
@returns `true` if the error is an `HTTPError`, `false` otherwise

@example
```
import ky, {isHTTPError} from 'ky';
try {
	const response = await ky.get('/api/data');
} catch (error) {
	if (isHTTPError(error)) {
		console.log('HTTP error status:', error.response.status);
	}
}
```
*/
export function isHTTPError<T = unknown>(error: unknown): error is HTTPError<T> {
	return isErrorType(error, HTTPError);
}

/**
Type guard to check if an error is a `NetworkError`.

@param error - The error to check
@returns `true` if the error is a `NetworkError`, `false` otherwise

@example
```
import ky, {isNetworkError} from 'ky';
try {
	const response = await ky.get('/api/data');
} catch (error) {
	if (isNetworkError(error)) {
		console.log('Network error:', error.request.url);
	}
}
```
*/
export function isNetworkError(error: unknown): error is NetworkError {
	return isErrorType(error, NetworkError);
}

/**
Type guard to check if an error is a `TimeoutError`.

@param error - The error to check
@returns `true` if the error is a `TimeoutError`, `false` otherwise

@example
```
import ky, {isTimeoutError} from 'ky';
try {
	const response = await ky.get('/api/data', { timeout: 1000 });
} catch (error) {
	if (isTimeoutError(error)) {
		console.log('Request timed out:', error.request.url);
	}
}
```
*/
export function isTimeoutError(error: unknown): error is TimeoutError {
	return isErrorType(error, TimeoutError);
}

/**
Type guard to check if an error is a `ForceRetryError`.

@param error - The error to check
@returns `true` if the error is a `ForceRetryError`, `false` otherwise

@example
```
import ky, {isForceRetryError} from 'ky';

const api = ky.extend({
	hooks: {
		beforeRetry: [
			({error, retryCount}) => {
				if (isForceRetryError(error)) {
					console.log(`Forced retry #${retryCount}: ${error.code}`);
				}
			}
		]
	}
});
```
*/
export function isForceRetryError(error: unknown): error is ForceRetryError {
	return isErrorType(error, ForceRetryError);
}
