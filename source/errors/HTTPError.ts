import type {NormalizedOptions} from '../types/options.js';
import type {KyRequest} from '../types/request.js';
import type {KyResponse} from '../types/response.js';
import {KyError} from './KyError.js';

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
