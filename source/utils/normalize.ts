import {requestMethods} from '../core/constants.js';
import type {RetryOptions} from '../types/retry.js';
import type {HttpMethod, InternalOptions, RequestHttpMethod} from '../types/options.js';

export const normalizeRequestMethod = (input: string): string =>
	requestMethods.includes(input.toLowerCase() as RequestHttpMethod) ? input.toUpperCase() : input;

const retryMethods: HttpMethod[] = ['get', 'put', 'head', 'delete', 'options', 'trace', 'query'];

const retryStatusCodes = [408, 413, 429, 500, 502, 503, 504];

const retryAfterStatusCodes = [413, 429, 503];
const invalidRetryLimitErrorMessage = '`retry.limit` must be a finite, non-negative integer';

type InternalRetryOptions = InternalOptions['retry'];

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

const getDefaultRetryOptions = (): InternalRetryOptions => ({
	...defaultRetryOptions,
	methods: [...defaultRetryOptions.methods],
	statusCodes: [...defaultRetryOptions.statusCodes],
	afterStatusCodes: [...defaultRetryOptions.afterStatusCodes],
});

/**
Normalizes an omitted retry limit or validates a supplied one.
*/
const normalizeRetryLimit = (retryLimit: unknown): number => {
	if (retryLimit === undefined) {
		return defaultRetryOptions.limit;
	}

	if (typeof retryLimit !== 'number' || !Number.isInteger(retryLimit) || retryLimit < 0) {
		throw new TypeError(invalidRetryLimitErrorMessage);
	}

	return retryLimit;
};

export const normalizeRetryOptions = (retry: number | RetryOptions = {}): InternalRetryOptions => {
	if (typeof retry === 'number') {
		return {
			...getDefaultRetryOptions(),
			limit: normalizeRetryLimit(retry),
		};
	}

	if (retry === null || typeof retry !== 'object' || Array.isArray(retry)) {
		throw new TypeError('`retry` must be a number or an object');
	}

	const normalizedRetry = Object.fromEntries(Object.entries(retry).filter(([, value]) => value !== undefined)) as RetryOptions;
	const retryLimit = normalizeRetryLimit(normalizedRetry.limit);

	if (normalizedRetry.methods !== undefined && !Array.isArray(normalizedRetry.methods)) {
		throw new Error('retry.methods must be an array');
	}

	if (normalizedRetry.statusCodes !== undefined && !Array.isArray(normalizedRetry.statusCodes)) {
		throw new Error('retry.statusCodes must be an array');
	}

	if (normalizedRetry.afterStatusCodes !== undefined && !Array.isArray(normalizedRetry.afterStatusCodes)) {
		throw new Error('retry.afterStatusCodes must be an array');
	}

	if (normalizedRetry.methods !== undefined) {
		normalizedRetry.methods = normalizedRetry.methods.map(method => method.toLowerCase());
	}

	if (normalizedRetry.statusCodes !== undefined) {
		normalizedRetry.statusCodes = [...normalizedRetry.statusCodes];
	}

	if (normalizedRetry.afterStatusCodes !== undefined) {
		normalizedRetry.afterStatusCodes = [...normalizedRetry.afterStatusCodes];
	}

	return {
		...getDefaultRetryOptions(),
		...normalizedRetry,
		limit: retryLimit,
	};
};
