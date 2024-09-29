import {kyOptionKeys, requestOptionsRegistry} from '../core/constants';

export const findUnknownOptions = (
	request: Request,
	options: Record<string, unknown>,
): Record<string, unknown> => {
	const unknownOptions: Record<string, unknown> = {};

	for (const key in options) {
		if (!(key in requestOptionsRegistry) && !(key in kyOptionKeys) && !(key in request)) {
			unknownOptions[key] = options[key];
		}
	}

	return unknownOptions;
};
