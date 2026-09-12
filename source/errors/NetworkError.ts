import type {KyRequest} from '../types/request.js';
import {KyError} from './KyError.js';

/**
Error thrown when a network error occurs during the request (e.g., DNS failure, connection refused, offline). It has a `request` property with the `Request` object. The original error is available via the standard `cause` property.

Network errors are automatically retried (for retriable methods). A connection that drops while a Ky shortcut method like `.json()` is reading the response body is also wrapped in `NetworkError`, but it is not retried because the response has already been received.

Note: Network errors are detected using runtime-specific heuristics. Unrecognized runtimes may produce errors that are not wrapped in `NetworkError`. Use the `shouldRetry` option to handle such cases.
*/
export class NetworkError extends KyError {
	override name = 'NetworkError' as const;
	request: KyRequest;

	constructor(request: Request, options?: {cause?: Error | undefined}) {
		super(`Request failed due to a network error: ${request.method} ${request.url}`, options);
		this.request = request;
	}
}
