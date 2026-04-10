import {kyOptionKeys, requestOptionsRegistry} from '../core/constants.js';
import type {SearchParamsOption} from '../types/options.js';
import {deletedParametersSymbol} from './merge.js';

export const findUnknownOptions = (
	options: Record<string, unknown>,
): Record<string, unknown> => {
	const unknownOptions: Record<string, unknown> = {};

	for (const key in options) {
		// Skip inherited properties
		if (!Object.hasOwn(options, key)) {
			continue;
		}

		// Forward every non-standard, non-Ky option to fetch().
		// We intentionally do not check whether the key also exists on `Request`, because some runtimes
		// patch `Request.prototype` with fetch-only extensions. For example, Next.js adds `next`, and the
		// old `key in request` heuristic dropped it unless Ky kept a special-case allowlist.
		// Passing all non-standard keys makes that allowlist unnecessary and preserves future fetch extensions too.
		if (!(key in requestOptionsRegistry) && !(key in kyOptionKeys)) {
			unknownOptions[key] = options[key];
		}
	}

	return unknownOptions;
};

export const hasSearchParameters = (search: SearchParamsOption): boolean => {
	if (search === undefined) {
		return false;
	}

	// The `typeof array` still gives "object", so we need different checking for array.
	if (Array.isArray(search)) {
		return search.length > 0;
	}

	if (search instanceof URLSearchParams) {
		return search.size > 0 || Boolean((search as any)[deletedParametersSymbol]?.size);
	}

	// Record
	if (typeof search === 'object') {
		return Object.keys(search).length > 0;
	}

	if (typeof search === 'string') {
		return search.trim().length > 0;
	}

	return Boolean(search);
};
