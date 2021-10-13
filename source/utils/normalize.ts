import {requestMethods} from '../core/constants.js';
import type {HttpMethod} from '../types/options.js';
import type {RetryOptions} from '../types/retry.js';

export const normalizeRequestMethod = (input: string): string =>
	requestMethods.includes(input as HttpMethod) ? input.toUpperCase() : input;

const retryMethods = ['get', 'put', 'head', 'delete', 'options', 'trace'];

const retryStatusCodes = [408, 413, 429, 500, 502, 503, 504];

const retryAfterStatusCodes = [413, 429, 503];

const defaultRetryOptions: Required<RetryOptions> = {
	limit: 2,
	methods: retryMethods,
	statusCodes: retryStatusCodes,
	afterStatusCodes: retryAfterStatusCodes,
	maxRetryAfter: Number.POSITIVE_INFINITY,
};

export const normalizeRetryOptions = (retry: number | RetryOptions = {}): Required<RetryOptions> => {
	if (typeof retry === 'number') {
		return {
			...defaultRetryOptions,
			limit: retry,
		};
	}

	if (retry.methods && !Array.isArray(retry.methods)) {
		throw new Error('retry.methods must be an array');
	}

	if (retry.statusCodes && !Array.isArray(retry.statusCodes)) {
		throw new Error('retry.statusCodes must be an array');
	}

	return {
		...defaultRetryOptions,
		...retry,
		afterStatusCodes: retryAfterStatusCodes,
	};
};
