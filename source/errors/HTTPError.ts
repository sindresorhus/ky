import type {NormalizedOptions} from '../types/options';
import type {KyRequest} from '../types/request';
import type {KyResponse} from '../types/response';

export class HTTPError<T = unknown> extends Error {
	public response: KyResponse<T>;
	public request: KyRequest;
	public options: NormalizedOptions;

	constructor(response: Response, request: Request, options: NormalizedOptions) {
		const code = (response.status || response.status === 0) ? response.status : '';
		const title = response.statusText || '';
		const status = `${code} ${title}`.trim();
		const reason = status ? `status code ${status}` : 'an unknown error';

		super(`Request failed with ${reason}: ${request.method} ${request.url}`);

		this.name = 'HTTPError';
		this.response = response;
		this.request = request;
		this.options = options;
	}
}
