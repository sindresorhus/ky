import {TimeoutError} from '../errors/TimeoutError.js';
import pDefer from './p-defer.js';

export type TimeoutOptions = {
	timeout: number;
	fetch: typeof fetch;
};

// `Promise.race()` workaround (#91)
export default async function timeout(
	request: Request,
	abortController: AbortController | undefined,
	options: TimeoutOptions,
): Promise<Response> {
	const {promise, resolve, reject} = pDefer<Response>();

	const timeoutId = setTimeout(() => {
		if (abortController) {
			abortController.abort();
		}

		reject(new TimeoutError(request));
	}, options.timeout);

	try {
		resolve(await options.fetch(request));
	} catch (error: unknown) {
		reject(error);
	} finally {
		clearTimeout(timeoutId);
	}

	return promise;
}
