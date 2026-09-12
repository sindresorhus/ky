import {requestMethods} from '../core/constants.js';
import type {RetryOptions} from '../types/retry.js';
import type {HttpMethod, InternalOptions, RequestHttpMethod} from '../types/options.js';

export const normalizeRequestMethod = (input: string): string =>
	requestMethods.includes(input.toLowerCase() as RequestHttpMethod) ? input.toUpperCase() : input;

const caseInsensitiveMethods = new Set<string>([...requestMethods, 'options', 'trace']);

/**
Normalizes common methods for retry matching while preserving case-sensitive custom methods.
*/
export const normalizeRetryMethod = (method: string): string =>
	caseInsensitiveMethods.has(method.toLowerCase()) ? method.toLowerCase() : method;

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
		retry = {limit: retry};
	}

	if (retry === null || typeof retry !== 'object' || Array.isArray(retry)) {
		throw new TypeError('`retry` must be a number or an object');
	}

	const normalizedRetry = {
		...defaultRetryOptions,
		...Object.fromEntries(Object.entries(retry).filter(([, value]) => value !== undefined)),
	};
	normalizedRetry.limit = normalizeRetryLimit(normalizedRetry.limit);

	for (const key of ['methods', 'statusCodes', 'afterStatusCodes'] as const) {
		if (!Array.isArray(normalizedRetry[key])) {
			// eslint-disable-next-line unicorn/prefer-type-error -- Preserve the existing error type.
			throw new Error(`retry.${key} must be an array`);
		}
	}

	normalizedRetry.methods = normalizedRetry.methods.map(method => normalizeRetryMethod(method));
	normalizedRetry.statusCodes = [...normalizedRetry.statusCodes];
	normalizedRetry.afterStatusCodes = [...normalizedRetry.afterStatusCodes];

	return normalizedRetry;
};
