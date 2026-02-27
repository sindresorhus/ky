/**
Base class for all Ky-specific errors. `HTTPError`, `TimeoutError`, and `ForceRetryError` extend this class.
*/
export class KyError extends Error {
	override name = 'KyError';
}
