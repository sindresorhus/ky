import type {KyRequest} from '../types/request.js';
import {KyError} from './KyError.js';

export class TimeoutError extends KyError {
	override name = 'TimeoutError' as const;
	request: KyRequest;

	constructor(request: Request) {
		super(`Request timed out: ${request.method} ${request.url}`);
		this.request = request;
	}
}
