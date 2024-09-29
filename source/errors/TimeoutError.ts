import type {KyRequest} from '../types/request';

export class TimeoutError extends Error {
	public request: KyRequest;

	constructor(request: Request) {
		super(`Request timed out: ${request.method} ${request.url}`);
		this.name = 'TimeoutError';
		this.request = request;
	}
}
