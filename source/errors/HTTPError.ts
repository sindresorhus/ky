import type {NormalizedOptions} from '../types/options.js';
import type {KyRequest} from '../types/request.js';
import type {KyResponse} from '../types/response.js';
import {KyError} from './KyError.js';

/**
Error thrown when the response has a non-2xx status code and `throwHttpErrors` is enabled.

The error has a `response` property with the `Response` object, a `request` property with the `Request` object, an `options` property with the normalized options (either passed to `ky` when creating an instance with `ky.create()` or directly when performing the request), and a `data` property with the pre-parsed response body. For JSON responses (based on `Content-Type`), the body is parsed using the `parseJson` option if set, or `JSON.parse` by default. For other content types, it is set as plain text. If the body is empty or parsing fails, `data` will be `undefined`. To avoid hanging or excessive buffering, `error.data` population is bounded by the request timeout and a 10 MiB response body size limit. The `data` property is populated before `beforeError` hooks run, so hooks can access it.

The response body is automatically consumed when populating `error.data`, so `error.response.json()` and other body methods will not work. Use `error.data` instead. The `error.response` object is still available for headers, status, etc.

Be aware that some types of errors, such as network errors, inherently mean that a response was not received. In that case, the error will be an instance of `NetworkError` instead of `HTTPError` and will not contain a `response` property.
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
