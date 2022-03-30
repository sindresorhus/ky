// TODO: Use `??` instead of '||' when targeting Node.js 14
const DOMException = globalThis.DOMException || Error;

export default DOMException;

export function composeAbortError(signal: AbortSignal) {
	// TODO: Use `??` instead of '||' when targeting Node.js 14
	// @ts-ignore `.reason` is a valid property but is not yet added to the dom typings
	return new DOMException(signal.reason || 'The operation was aborted.');
}
