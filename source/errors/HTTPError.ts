import type {NormalizedOptions} from '../types/options.js';
import type {KyRequest} from '../types/request.js';
import type {KyResponse} from '../types/response.js';
import {KyError} from './KyError.js';

/**
Error thrown when the response has a non-2xx status code and `throwHttpErrors` is enabled.

The error has a `response` property with the `Response` object, a `request` property with the `Request` object, and a `data` property with the pre-parsed response body.
*/
export class HTTPError<T = unknown> extends KyError {
	override name = 'HTTPError' as const;
	response: KyResponse<T>;
	request: KyRequest;
	options: NormalizedOptions;
	data: T | string | undefined;

	constructor(response: Response, request: Request, options: NormalizedOptions) {
		const code = (response.status || response.status === 0) ? response.status : '';
		const title = response.statusText ?? '';
		const status = `${code} ${title}`.trim();
		const reason = status ? `status code ${status}` : 'an unknown error';

		super(`Request failed with ${reason}: ${request.method} ${request.url}`);

		this.response = response;
		this.request = request;
		this.options = options;
	}
}
