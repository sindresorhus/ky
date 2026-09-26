/*! MIT License © Sindre Sorhus */

import {Ky} from './core/Ky.js';
import {
	requestMethods,
	responseTypes,
	stop,
	retry,
} from './core/constants.js';
import type {KyInstance} from './types/ky.js';
import type {Input, Options} from './types/options.js';
import type {ResponsePromise} from './types/ResponsePromise.js';
import {cloneDeep, validateAndMerge} from './utils/merge.js';
import {type Mutable} from './utils/types.js';

// Errors while setting up the request, such as invalid options or a throwing `init` hook, reject the returned promise instead of throwing, the same way `fetch()` reports them, so callers only have one error channel to handle.
const createRequest = (input: Input, getOptions: () => Options): ResponsePromise => {
	try {
		return Ky.create(input, getOptions());
	} catch (error: unknown) {
		// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- A hook can throw any value, and it must be preserved exactly.
		const result = Promise.reject(error) as ResponsePromise;
		for (const type of Object.keys(responseTypes) as Array<keyof typeof responseTypes>) {
			// Matches `Ky.create()`, which only exposes `.bytes()` when the environment implements it.
			if (type === 'bytes' && typeof (globalThis.Response?.prototype as unknown as {bytes?: unknown})?.bytes !== 'function') {
				continue;
			}

			// Returning the same promise marks it as handled, so a body method call does not also report an unhandled rejection.
			result[type] = async () => result as never;
		}

		return result;
	}
};

const createInstance = (defaults?: Partial<Options>): KyInstance => {
	// eslint-disable-next-line @typescript-eslint/promise-function-async
	const ky: Partial<Mutable<KyInstance>> = (input: Input, options?: Options) => createRequest(input, () => validateAndMerge(defaults, options));

	for (const method of requestMethods) {
		// eslint-disable-next-line @typescript-eslint/promise-function-async
		ky[method] = (input: Input, options?: Options) => createRequest(input, () => validateAndMerge(defaults, options, {method}));
	}

	ky.create = (newDefaults?: Partial<Options>) => createInstance(validateAndMerge(newDefaults));
	ky.extend = (newDefaults?: Partial<Options> | ((parentDefaults: Partial<Options>) => Partial<Options>)) => {
		if (typeof newDefaults === 'function') {
			// Pass a deep copy so mutations inside the callback cannot leak into this instance's defaults. Deep, because options like `context` are merged shallowly, so a nested value would still point at the parent's object.
			newDefaults = newDefaults(validateAndMerge(cloneDeep(defaults)));
		}

		return createInstance(validateAndMerge(defaults, newDefaults));
	};

	ky.stop = stop;
	ky.retry = retry;

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
	ShouldRetryState,
	SearchParamsOption,
	Progress,
} from './types/options.js';

export type {
	Hooks,
	InitHook,
	BeforeRequestHook,
	BeforeRequestState,
	BeforeRetryHook,
	BeforeRetryState,
	BeforeErrorHook,
	BeforeErrorState,
	AfterResponseHook,
	AfterResponseState,
} from './types/hooks.js';

export type {ResponsePromise} from './types/ResponsePromise.js';
export type {
	StandardSchemaV1,
	StandardSchemaV1InferOutput,
	StandardSchemaV1Issue,
} from './types/standard-schema.js';
export type {KyRequest} from './types/request.js';
export type {KyResponse} from './types/response.js';
export {KyError} from './errors/KyError.js';
export {HTTPError} from './errors/HTTPError.js';
export {SchemaValidationError} from './errors/SchemaValidationError.js';
export {NetworkError} from './errors/NetworkError.js';
export {TimeoutError} from './errors/TimeoutError.js';
export {ResponseSizeError} from './errors/ResponseSizeError.js';
export {ForceRetryError} from './errors/ForceRetryError.js';
export {
	isKyError,
	isHTTPError,
	isNetworkError,
	isTimeoutError,
	isResponseSizeError,
	isForceRetryError,
} from './utils/type-guards.js';
export {replaceOption} from './utils/merge.js';

// Intentionally not exporting this for now as it's just an implementation detail and we don't want to commit to a certain API yet at least.
// export {NonError} from './errors/NonError.js';
