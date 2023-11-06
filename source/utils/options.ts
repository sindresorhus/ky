import {kyOptionKeys, requestOptionsRegistry} from '../core/constants.js';

export const findUnknownOptions = (
	options: Record<string, unknown>,
): Record<string, unknown> => {
	const unknownOptions: Record<string, unknown> = {};

	for (const key in options) {
		if (!(key in requestOptionsRegistry) && !(key in kyOptionKeys)) {
			unknownOptions[key] = options[key];
		}
	}

	return unknownOptions;
};
