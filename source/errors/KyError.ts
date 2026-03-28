/**
Base class for all Ky-specific errors. `HTTPError`, `NetworkError`, `TimeoutError`, and `ForceRetryError` extend this class.
*/
export class KyError extends Error {
	override name = 'KyError';

	get isKyError(): true {
		return true;
	}
}
