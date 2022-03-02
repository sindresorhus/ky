import {TimeoutError} from '../errors/TimeoutError.js';

export type TimeoutOptions = {
	timeout: number;
	fetch: typeof fetch;
};

// `Promise.race()` workaround (#91)
export const timeout = async (
	request: Request,
	abortController: AbortController | undefined,
	options: TimeoutOptions,
): Promise<Response> =>
	new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			if (abortController) {
				abortController.abort();
			}

			reject(new TimeoutError(request));
		}, options.timeout);

		void options
			.fetch(request)
			.then(resolve)
			.catch(reject)
			.then(() => {
				clearTimeout(timeoutId);
			});
	});

export const delay = async (ms: number) => new Promise(resolve => {
	setTimeout(resolve, ms);
});
