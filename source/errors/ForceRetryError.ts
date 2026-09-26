import type {ForceRetryOptions} from '../core/constants.js';
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
		// The custom delay flows straight into `setTimeout`, so a negative or `NaN` value would be clamped to 1ms and silently collapse the backoff, the same failure mode validated away for `retry.delay`.
		const {delay} = options ?? {};
		if (delay !== undefined && (typeof delay !== 'number' || Number.isNaN(delay) || delay < 0)) {
			throw new TypeError('The `delay` option must be a non-negative number or `Infinity`');
		}

		// Runtime protection: wrap non-Error causes in NonError
		// TypeScript type is Error for guidance, but JS users can pass anything
		const cause = options?.cause === undefined
			? undefined
			: (options.cause instanceof Error ? options.cause : new NonError(options.cause));

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
