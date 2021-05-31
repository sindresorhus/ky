/*! MIT License © Sindre Sorhus */

import {Ky} from './core/Ky.js';
import {requestMethods, stop} from './core/constants.js';
import type {ky as KyInterface} from './types/ky.js';
import type {Input, Options} from './types/options.js';
import {validateAndMerge} from './utils/merge.js';

const createInstance = (defaults?: Partial<Options>): KyInterface => {
	// eslint-disable-next-line @typescript-eslint/promise-function-async
	const ky = (input: Input, options?: Options) => Ky.create(input, validateAndMerge(defaults, options));

	for (const method of requestMethods) {
		// @ts-expect-error not sure how to properly type this!
		// eslint-disable-next-line @typescript-eslint/promise-function-async
		ky[method] = (input: Input, options: Options) => Ky.create(input, validateAndMerge(defaults, options, {method}));
	}

	ky.create = (newDefaults?: Partial<Options>) => createInstance(validateAndMerge(newDefaults));
	ky.extend = (newDefaults?: Partial<Options>) => createInstance(validateAndMerge(defaults, newDefaults));
	ky.stop = stop;

	return ky as KyInterface;
};

const ky = createInstance();

export default ky;

export {
	Options,
	NormalizedOptions,
	RetryOptions,
	SearchParamsOption,
	DownloadProgress
} from './types/options.js';

export {
	Hooks,
	BeforeRequestHook,
	BeforeRetryHook,
	AfterResponseHook
} from './types/hooks.js';

export {ResponsePromise} from './types/response.js';
export {HTTPError} from './errors/HTTPError.js';
export {TimeoutError} from './errors/TimeoutError.js';
