/*! MIT License © Sindre Sorhus */

import {Ky} from './core/Ky.js';
import {requestMethods, stop} from './core/constants.js';
import type {GetTypedReturnKyInstance} from './types/ky.js';
import type {Input, Options} from './types/options.js';
import {validateAndMerge} from './utils/merge.js';

const createInstance = <T extends Partial<Options>>(defaults?: T): GetTypedReturnKyInstance<T> => {
	// eslint-disable-next-line @typescript-eslint/promise-function-async
	const ky = (input: Input, options?: Partial<Options>) => Ky.create(input, validateAndMerge(defaults, options));

	for (const method of requestMethods) {
		// TS is a headache here because of generic values and stuff; type casting of return value is the only thing that really matters anyway
		// @ts-expect-error
		// eslint-disable-next-line @typescript-eslint/promise-function-async
		ky[method] = (input: Input, options?: Partial<Options>) => Ky.create(input, validateAndMerge(defaults, options, {method}));
	}

	ky.create = <K extends Partial<Options>>(newDefaults?: K) => createInstance<K>(validateAndMerge(newDefaults) as K);
	ky.extend = <K extends Partial<Options>>(newDefaults?: K | ((parentDefaults: T | Record<string | number | symbol, unknown>) => K)) => {
		if (typeof newDefaults === 'function') {
			newDefaults = newDefaults(defaults ?? {});
		}

		return createInstance(validateAndMerge(defaults, newDefaults) as K & T) as GetTypedReturnKyInstance<K & T>;
	};

	ky.stop = stop;

	return ky as GetTypedReturnKyInstance<T>;
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
