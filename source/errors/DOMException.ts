const domExceptionSupported = Boolean(globalThis.DOMException);

// When targeting Node.js 18, use `signal.throwIfAborted()` (https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/throwIfAborted)
export function composeAbortError(signal?: AbortSignal) {
	// Supported on most modern browsers, and from Node >= 17. (https://developer.mozilla.org/en-US/docs/Web/API/DOMException#browser_compatibility)
	if (domExceptionSupported) {
		return new DOMException(signal?.reason ?? 'The operation was aborted.', 'AbortError');
	}

	const error = new Error(signal?.reason ?? 'The operation was aborted.');
	error.name = 'AbortError';

	return error;
}
