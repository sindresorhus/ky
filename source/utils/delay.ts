// https://github.com/sindresorhus/delay/tree/ab98ae8dfcb38e1593286c94d934e70d14a4e111

import {composeAbortError} from '../errors/DOMException.js';
import pDefer from './p-defer.js';

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
		signal?.removeEventListener('abort', handleAbort);
		resolve();
	}, ms);

	return promise;
}
