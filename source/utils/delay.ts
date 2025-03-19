// https://github.com/sindresorhus/delay/tree/ab98ae8dfcb38e1593286c94d934e70d14a4e111

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
			signal.throwIfAborted();
			signal.addEventListener('abort', abortHandler, {once: true});
		}

		function abortHandler() {
			clearTimeout(timeoutId);
			reject(signal!.reason as Error);
		}

		const timeoutId = setTimeout(() => {
			signal?.removeEventListener('abort', abortHandler);
			resolve();
		}, ms);
	});
}
