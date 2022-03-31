const DOMException = globalThis.DOMException ?? Error;

export default DOMException;

export function composeAbortError(signal?: AbortSignal) {
	// @ts-expect-error `.reason` is a valid property but is not yet added to the dom typings
	return new DOMException(signal?.reason ?? 'The operation was aborted.');
}
