/*! MIT License © Sindre Sorhus */

import {Ky} from './core/Ky';
import {requestMethods, stop} from './core/constants';
import type {KyInstance} from './types/ky';
import type {Input, Options} from './types/options';
import {validateAndMerge} from './utils/merge';
import {type Mutable} from './utils/types';

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

export type {KyInstance} from './types/ky';

export type {
	Input,
	Options,
	NormalizedOptions,
	RetryOptions,
	SearchParamsOption,
	DownloadProgress,
} from './types/options';

export type {
	Hooks,
	BeforeRequestHook,
	BeforeRetryHook,
	BeforeRetryState,
	BeforeErrorHook,
	AfterResponseHook,
} from './types/hooks';

export type {ResponsePromise} from './types/ResponsePromise';
export type {KyRequest} from './types/request';
export type {KyResponse} from './types/response';
export {HTTPError} from './errors/HTTPError';
export {TimeoutError} from './errors/TimeoutError';
