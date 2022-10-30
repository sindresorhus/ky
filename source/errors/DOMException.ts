const DOMException = globalThis.DOMException ?? Error;

export default DOMException;

// When targeting Node.js 18, use `signal.throwIfAborted()` (https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/throwIfAborted)
export function composeAbortError(signal?: AbortSignal) {
	return new DOMException(signal?.reason ?? 'The operation was aborted.');
}
