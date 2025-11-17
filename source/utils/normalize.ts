import {requestMethods} from '../core/constants.js';
import type {RetryOptions} from '../types/retry.js';
import type {HttpMethod, RequestHttpMethod} from '../types/options.js';

export const normalizeRequestMethod = (input: string): string =>
	requestMethods.includes(input as RequestHttpMethod) ? input.toUpperCase() : input;

const retryMethods: HttpMethod[] = ['get', 'put', 'head', 'delete', 'options', 'trace'];

const retryStatusCodes = [408, 413, 429, 500, 502, 503, 504];

const retryAfterStatusCodes = [413, 429, 503];

type InternalRetryOptions = Required<Omit<RetryOptions, 'shouldRetry'>> & Pick<RetryOptions, 'shouldRetry'>;

const defaultRetryOptions: InternalRetryOptions = {
	limit: 2,
	methods: retryMethods,
	statusCodes: retryStatusCodes,
	afterStatusCodes: retryAfterStatusCodes,
	maxRetryAfter: Number.POSITIVE_INFINITY,
	backoffLimit: Number.POSITIVE_INFINITY,
	delay: attemptCount => 0.3 * (2 ** (attemptCount - 1)) * 1000,
	jitter: undefined,
	retryOnTimeout: false,
};

export const normalizeRetryOptions = (retry: number | RetryOptions = {}): InternalRetryOptions => {
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
	};
};
