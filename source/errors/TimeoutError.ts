import type {KyRequest} from '../types/request.js';
import {ERROR_NAMES} from '../core/constants.js';

export class TimeoutError extends Error {
	public request: KyRequest;

	constructor(request: Request) {
		super(`Request timed out: ${request.method} ${request.url}`);
		this.name = ERROR_NAMES.TimeoutError;
		this.request = request;
	}
}
