import {kyOptionKeys} from '../core/constants.js';

export const findUnknownOptions = (
	request: Request,
	options: Record<string, unknown>,
): Record<string, unknown> => {
	const unknownOptions: Record<string, unknown> = {};

	for (const key in options) {
		if (!(key in kyOptionKeys) && !(key in request)) {
			unknownOptions[key] = options[key];
		}
	}

	return unknownOptions;
};
