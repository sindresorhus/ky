import ky, {
	isHTTPError,
	isNetworkError,
	isTimeoutError,
	isForceRetryError,
	SchemaValidationError,
} from 'ky';

void ky('https://example.com', {
	hooks: {
		beforeError: [({error}) => {
			if (isHTTPError(error)) {
				error.name = 'GitHubError';
			}

			if (isNetworkError(error)) {
				error.name = 'OfflineError';
			}

			if (isTimeoutError(error)) {
				error.name = 'CustomTimeoutError';
			}

			if (isForceRetryError(error)) {
				error.name = 'CustomRetryError';
			}

			return error;
		}],
	},
});

const validationError = new SchemaValidationError([{message: 'Invalid response'}]);
validationError.name = 'InvalidResponseError';
