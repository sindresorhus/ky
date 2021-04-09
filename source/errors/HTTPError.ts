import type {NormalizedOptions} from '../types/options.js';

export class HTTPError extends Error {
	public response: Response;
	public request: Request;
	public options: NormalizedOptions;
	constructor(response: Response, request: Request, options: NormalizedOptions) {
		// Set the message to the status text, such as Unauthorized,
		// with some fallbacks. This message should never be undefined.
		super(
			response.statusText ||
				String(response.status === 0 || response.status ? response.status : 'Unknown response error')
		);
		this.name = 'HTTPError';
		this.response = response;
		this.request = request;
		this.options = options;
	}
}
