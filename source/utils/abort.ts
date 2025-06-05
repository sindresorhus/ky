/**
A ponyfill for [`AbortSignal.any`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static).
*/
export function abortSignalAny(
	signals: AbortSignal[],
): AbortSignal {
	if (typeof AbortSignal.any === 'function') {
		return AbortSignal.any(signals);
	}

	const controller = new AbortController();

	for (const signal of signals) {
		if (signal.aborted) {
			controller.abort();
		} else {
			signal.addEventListener('abort', () => {
				controller.abort();
			}, {once: true});
		}
	}

	return controller.signal;
}
