import {requestMethods} from '../core/constants.js';
import type {RetryOptions} from '../types/retry.js';
import type {HttpMethod, InternalOptions, RequestHttpMethod} from '../types/options.js';
import {isNonArrayObject, isNonNegativeNumber} from './is.js';

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

export const normalizeRetryOptions = (retry: number | RetryOptions = {}): InternalRetryOptions => {
	if (typeof retry === 'number') {
		retry = {limit: retry};
	}

	if (!isNonArrayObject(retry)) {
		throw new TypeError('`retry` must be a number or an object');
	}

	const normalizedRetry = {
		...defaultRetryOptions,
		...Object.fromEntries(Object.entries(retry).filter(([, value]) => value !== undefined)),
	};
	// Validates the retry limit. An omitted one already got the default above, since `undefined` values are filtered out.
	if (!Number.isInteger(normalizedRetry.limit) || normalizedRetry.limit < 0) {
		throw new TypeError('`retry.limit` must be a finite, non-negative integer');
	}

	for (const key of ['methods', 'statusCodes', 'afterStatusCodes'] as const) {
		if (!Array.isArray(normalizedRetry[key])) {
			// eslint-disable-next-line unicorn/prefer-type-error -- Preserve the existing error type.
			throw new Error(`retry.${key} must be an array`);
		}
	}

	// A mistyped entry only ever fails to match, so `statusCodes: ['429']` quietly disabled retrying instead of reporting the typo.
	for (const [key, isValid] of [
		['methods', (value: unknown) => typeof value === 'string'],
		['statusCodes', (value: unknown) => Number.isInteger(value)],
		['afterStatusCodes', (value: unknown) => Number.isInteger(value)],
	] as const) {
		if (normalizedRetry[key].some(value => !isValid(value))) {
			throw new TypeError(`\`retry.${key}\` must only contain ${key === 'methods' ? 'strings' : 'numbers'}`);
		}
	}

	// Both limits are passed to `Math.min()`, so a non-number silently turns every delay into `NaN`, which `setTimeout()` clamps to 1ms. That defeats the whole point of the limits.
	for (const key of ['maxRetryAfter', 'backoffLimit'] as const) {
		if (!isNonNegativeNumber(normalizedRetry[key])) {
			throw new TypeError(`\`retry.${key}\` must be a non-negative number or \`Infinity\``);
		}
	}

	// These run while deciding what to do with the original failure, so an invalid shape would replace the `HTTPError`/`NetworkError` that caused the retry with a `TypeError` from deep inside Ky.
	for (const key of ['delay', 'shouldRetry'] as const) {
		if (normalizedRetry[key] !== undefined && typeof normalizedRetry[key] !== 'function') {
			throw new TypeError(`\`retry.${key}\` must be a function`);
		}
	}

	if (normalizedRetry.jitter !== undefined && typeof normalizedRetry.jitter !== 'boolean' && typeof normalizedRetry.jitter !== 'function') {
		throw new TypeError('`retry.jitter` must be a boolean or a function');
	}

	if (typeof normalizedRetry.retryOnTimeout !== 'boolean') {
		throw new TypeError('`retry.retryOnTimeout` must be a boolean');
	}

	normalizedRetry.methods = normalizedRetry.methods.map(method => normalizeRetryMethod(method));
	normalizedRetry.statusCodes = [...normalizedRetry.statusCodes];
	normalizedRetry.afterStatusCodes = [...normalizedRetry.afterStatusCodes];

	return normalizedRetry;
};
