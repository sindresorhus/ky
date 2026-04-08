/**
Base class for all Ky-specific errors. `HTTPError`, `NetworkError`, `TimeoutError`, and `ForceRetryError` extend this class.

You can use `instanceof KyError` to check if an error originated from Ky, or use the `isKyError()` type guard for cross-realm compatibility and TypeScript type narrowing.

Note: `SchemaValidationError` is intentionally not considered a Ky error. `KyError` covers failures in Ky's HTTP lifecycle (bad status, timeout, retry), while schema validation errors originate from the user-provided schema, not from Ky itself.
*/
export class KyError extends Error {
	override name = 'KyError';

	get isKyError(): true {
		return true;
	}
}
