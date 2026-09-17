import {TimeoutError} from '../errors/TimeoutError.js';
import type {InternalOptions} from '../types/options.js';

export type TimeoutOptions = {
	timeout: number;
	fetch: InternalOptions['fetch'];
};

// `Promise.race()` workaround (#91)
export default async function timeout(
	request: Request,
	init: RequestInit,
	abortController: AbortController | undefined,
	options: TimeoutOptions,
): Promise<Response> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;

	try {
		return await new Promise((resolve, reject) => {
			timeoutId = setTimeout(() => {
				timedOut = true;

				if (abortController) {
					abortController.abort();
				}

				reject(new TimeoutError(request));
			}, options.timeout);

			// Called unbound so a native `window.fetch` is not invoked with `options` as `this`, which throws "Illegal invocation" in browsers.
			// A synchronous throw rejects the promise, and `finally` still clears the timer so it cannot abort a later retry attempt.
			const {fetch} = options;
			fetch(request, init).then(response => {
				// A response arriving after the timeout already won is discarded, so its unused body is cancelled. Fire-and-forget: cancellation failures are ignored and never delay the rejection.
				if (timedOut) {
					void response.body?.cancel().catch(() => undefined);
					return;
				}

				resolve(response);
			}).catch(reject);
		});
	} finally {
		clearTimeout(timeoutId);
	}
}
