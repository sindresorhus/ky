import type {ForceRetryOptions} from '../core/constants.js';

/**
Internal error used to signal a forced retry from afterResponse hooks.
This is thrown when a user returns ky.retry() from an afterResponse hook.
*/
export class ForceRetryError extends Error {
	override name = 'ForceRetryError' as const;
	customDelay: number | undefined;
	reason: string | undefined;

	constructor(options?: ForceRetryOptions) {
		super(options?.reason ? `Forced retry: ${options.reason}` : 'Forced retry');
		this.customDelay = options?.delay;
		this.reason = options?.reason;
	}
}
