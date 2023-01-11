// DomException is supported on most modern browsers, and Node >= 17.
// @see https://developer.mozilla.org/en-US/docs/Web/API/DOMException#browser_compatibility
const domExceptionSupported = Boolean(globalThis.DOMException);

// TODO: When targeting Node.js 18, use `signal.throwIfAborted()` (https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/throwIfAborted)
export function composeAbortError(signal?: AbortSignal) {
	/*
		NOTE: Use DomException with AbortError name as specified in MDN docs (https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort)
		> When abort() is called, the fetch() promise rejects with an Error of type DOMException, with name AbortError.
	 */
	if (domExceptionSupported) {
		return new DOMException(signal?.reason ?? 'The operation was aborted.', 'AbortError');
	}

	// DomException not supported fallback to use of error and override name
	const error = new Error(signal?.reason ?? 'The operation was aborted.');
	error.name = 'AbortError';

	return error;
}
