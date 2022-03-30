// https://github.com/sindresorhus/delay/tree/ab98ae8dfcb38e1593286c94d934e70d14a4e111

import pDefer from './p-defer.js';
import {composeAbortError} from '../errors/DOMException.js';

export interface DelayOptions {
	signal?: AbortSignal;
}

export default async function delay(
	ms: number,
	{signal}: DelayOptions,
): Promise<void> {
	if (signal) {
		if (signal.aborted) {
			throw composeAbortError(signal);
		}

		signal.addEventListener('abort', handleAbort, {once: true});
	}

	const {promise, resolve, reject} = pDefer<void>();

	function handleAbort() {
		reject(composeAbortError(signal));
		clearTimeout(timeoutId);
	}

	const timeoutId = setTimeout(() => {
		// TODO: Use `signal?.removeEventListener('abort', handleAbort);` when targeting Node.js 14
		if (signal) {
			signal.removeEventListener('abort', handleAbort);
		}

		resolve();
	}, ms);

	return promise;
}
