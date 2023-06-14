// https://github.com/sindresorhus/delay/tree/ab98ae8dfcb38e1593286c94d934e70d14a4e111

import {composeAbortError} from '../errors/DOMException.js';
import {type InternalOptions} from '../types/options.js';

export type DelayOptions = {
	signal?: InternalOptions['signal'];
};

export default async function delay(
	ms: number,
	{signal}: DelayOptions,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal) {
			if (signal.aborted) {
				reject(composeAbortError(signal));
				return;
			}

			signal.addEventListener('abort', handleAbort, {once: true});
		}

		function handleAbort() {
			reject(composeAbortError(signal!));
			clearTimeout(timeoutId);
		}

		const timeoutId = setTimeout(() => {
			signal?.removeEventListener('abort', handleAbort);
			resolve();
		}, ms);
	});
}
