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

	try {
		return await new Promise((resolve, reject) => {
			timeoutId = setTimeout(() => {
				if (abortController) {
					abortController.abort();
				}

				reject(new TimeoutError(request));
			}, options.timeout);

			// Called unbound so a native `window.fetch` is not invoked with `options` as `this`, which throws "Illegal invocation" in browsers.
			// A synchronous throw rejects the promise, and `finally` still clears the timer so it cannot abort a later retry attempt.
			const {fetch} = options;
			fetch(request, init).then(resolve).catch(reject);
		});
	} finally {
		clearTimeout(timeoutId);
	}
}
