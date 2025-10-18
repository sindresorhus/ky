/**
Wrapper for non-Error values that were thrown.

In JavaScript, any value can be thrown (not just Error instances). This class wraps such values to ensure consistent error handling.
*/
export class NonError extends Error {
	override name = 'NonError';
	readonly value: unknown;

	constructor(value: unknown) {
		let message = 'Non-error value was thrown';

		// Intentionally minimal as this error is just an edge-case.
		try {
			if (typeof value === 'string') {
				message = value;
			} else if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') {
				message = value.message;
			}
		} catch {
			// Use default message if accessing properties throws
		}

		super(message);

		this.value = value;
	}
}
