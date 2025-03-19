/*! MIT License © Sindre Sorhus */

import {Ky} from './core/Ky.js';
import {requestMethods, stop} from './core/constants.js';
import type {KyInstance} from './types/ky.js';
import type {Input, Options} from './types/options.js';
import {validateAndMerge} from './utils/merge.js';
import {type Mutable} from './utils/types.js';

const createInstance = (defaults?: Partial<Options>): KyInstance => {
	// eslint-disable-next-line @typescript-eslint/promise-function-async
	const ky: Partial<Mutable<KyInstance>> = (input: Input, options?: Options) => Ky.create(input, validateAndMerge(defaults, options));

	for (const method of requestMethods) {
		// eslint-disable-next-line @typescript-eslint/promise-function-async
		ky[method] = (input: Input, options?: Options) => Ky.create(input, validateAndMerge(defaults, options, {method}));
	}

	ky.create = (newDefaults?: Partial<Options>) => createInstance(validateAndMerge(newDefaults));
	ky.extend = (newDefaults?: Partial<Options> | ((parentDefaults: Partial<Options>) => Partial<Options>)) => {
		if (typeof newDefaults === 'function') {
			newDefaults = newDefaults(defaults ?? {});
		}

		return createInstance(validateAndMerge(defaults, newDefaults));
	};

	ky.stop = stop;

	return ky as KyInstance;
};

const ky = createInstance();

export default ky;

export type {KyInstance} from './types/ky.js';

export type {
	Input,
	Options,
	NormalizedOptions,
	RetryOptions,
	SearchParamsOption,
	Progress,
} from './types/options.js';

export type {
	Hooks,
	BeforeRequestHook,
	BeforeRetryHook,
	BeforeRetryState,
	BeforeErrorHook,
	AfterResponseHook,
} from './types/hooks.js';

export type {ResponsePromise} from './types/ResponsePromise.js';
export type {KyRequest} from './types/request.js';
export type {KyResponse} from './types/response.js';
export {HTTPError} from './errors/HTTPError.js';
export {TimeoutError} from './errors/TimeoutError.js';
