import type {ForceRetryOptions} from '../core/constants.js';
import {isNonNegativeNumber, isRequest} from '../utils/is.js';
import {KyError} from './KyError.js';
import {NonError} from './NonError.js';

/**
Error used to signal a forced retry from `afterResponse` hooks.

This is thrown when `ky.retry()` is returned from an `afterResponse` hook. It is observable in `beforeRetry` and `beforeError` hooks via the `isForceRetryError()` type guard.
*/
export class ForceRetryError extends KyError {
	override name = 'ForceRetryError';
	customDelay: number | undefined;
	code: string | undefined;
	customRequest: Request | undefined;

	constructor(options?: ForceRetryOptions) {
		// `null` is not accepted anywhere in Ky, so it is reported rather than treated like no options.
		if (options === null) {
			throw new TypeError('The `ky.retry()` options must be an object');
		}

		// The custom delay flows straight into `setTimeout`, so a negative or `NaN` value would be clamped to 1ms and silently collapse the backoff, the same failure mode validated away for `retry.delay`.
		const delay = options?.delay;
		if (delay !== undefined && !isNonNegativeNumber(delay)) {
			throw new TypeError('The `ky.retry()` `delay` option must be a non-negative number or `Infinity`');
		}

		if (options?.code !== undefined && typeof options.code !== 'string') {
			throw new TypeError('The `ky.retry()` `code` option must be a string');
		}

		// The request is only read when it is truthy, so `null` would otherwise silently retry with the original request. A `Request` from another realm is accepted, the same way a hook's returned request is.
		if (options?.request !== undefined && !isRequest(options.request)) {
			throw new TypeError('The `ky.retry()` `request` option must be a `Request`');
		}

		// Runtime protection: wrap non-Error causes in NonError
		// TypeScript type is Error for guidance, but JS users can pass anything
		const cause = options?.cause === undefined ? undefined : NonError.wrap(options.cause);

		super(
			// `code` is documented as always reaching the message, so only an absent code falls back.
			options?.code === undefined ? 'Forced retry' : `Forced retry: ${options.code}`,
			cause ? {cause} : undefined,
		);

		this.customDelay = options?.delay;
		this.code = options?.code;
		this.customRequest = options?.request;
	}
}
