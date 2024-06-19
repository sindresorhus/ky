export class TimeoutError extends Error {
	public request: Request;

	constructor(request: Request) {
		super('Request timed out', { cause: request.url });
		this.name = 'TimeoutError';
		this.request = request;
	}
}
