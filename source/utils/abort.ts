/**
 * A ponyfill for [`AbortSignal.any`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static).
 */
export function abortSignalAny(
	signals: AbortSignal[],
): AbortSignal {
	if (typeof AbortSignal.any === 'function') {
		return AbortSignal.any(signals);
	}

	const ac = new AbortController();

	for (const signal of signals) {
		if (signal.aborted) {
			ac.abort();
		} else {
			signal.addEventListener('abort', () => {
				ac.abort();
			}, {once: true});
		}
	}

	return ac.signal;
}
