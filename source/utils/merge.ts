import type {KyHeadersInit, Options} from '../types/options.js';
import type {Hooks} from '../types/hooks.js';
import {supportsAbortSignal} from '../core/constants.js';
import {isObject} from './is.js';

export const validateAndMerge = (...sources: Array<Partial<Options> | undefined>): Partial<Options> => {
	for (const source of sources) {
		if ((!isObject(source) || Array.isArray(source)) && source !== undefined) {
			throw new TypeError('The `options` argument must be an object');
		}
	}

	return deepMerge({}, ...sources);
};

export const mergeHeaders = (source1: KyHeadersInit = {}, source2: KyHeadersInit = {}) => {
	const result = new globalThis.Headers(source1 as RequestInit['headers']);
	const isHeadersInstance = source2 instanceof globalThis.Headers;
	const source = new globalThis.Headers(source2 as RequestInit['headers']);

	for (const [key, value] of source.entries()) {
		if ((isHeadersInstance && value === 'undefined') || value === undefined) {
			result.delete(key);
		} else {
			result.set(key, value);
		}
	}

	return result;
};

function newHookValue<K extends keyof Hooks>(original: Hooks, incoming: Hooks, property: K): Required<Hooks>[K] {
	return (Object.hasOwn(incoming, property) && incoming[property] === undefined)
		? []
		: deepMerge<Required<Hooks>[K]>(original[property] ?? [], incoming[property] ?? []);
}

export const mergeHooks = (original: Hooks = {}, incoming: Hooks = {}): Required<Hooks> => (
	{
		beforeRequest: newHookValue(original, incoming, 'beforeRequest'),
		beforeRetry: newHookValue(original, incoming, 'beforeRetry'),
		afterResponse: newHookValue(original, incoming, 'afterResponse'),
		beforeError: newHookValue(original, incoming, 'beforeError'),
	}
);

// TODO: Make this strongly-typed (no `any`).
export const deepMerge = <T>(...sources: Array<Partial<T> | undefined>): T => {
	let returnValue: any = {};
	let headers = {};
	let hooks = {};
	const signals: AbortSignal[] = [];

	for (const source of sources) {
		if (Array.isArray(source)) {
			if (!Array.isArray(returnValue)) {
				returnValue = [];
			}

			returnValue = [...returnValue, ...source];
		} else if (isObject(source)) {
			for (let [key, value] of Object.entries(source)) {
				// Special handling for AbortSignal instances
				if (key === 'signal' && value instanceof globalThis.AbortSignal) {
					signals.push(value);
					continue;
				}

				if (isObject(value) && key in returnValue) {
					value = deepMerge(returnValue[key], value);
				}

				returnValue = {...returnValue, [key]: value};
			}

			if (isObject((source as any).hooks)) {
				hooks = mergeHooks(hooks, (source as any).hooks);
				returnValue.hooks = hooks;
			}

			if (isObject((source as any).headers)) {
				headers = mergeHeaders(headers, (source as any).headers);
				returnValue.headers = headers;
			}
		}
	}

	if (signals.length > 0) {
		if (signals.length === 1) {
			returnValue.signal = signals[0];
		} else if (supportsAbortSignal) {
			returnValue.signal = AbortSignal.any(signals);
		} else {
			// When AbortSignal.any is not available, use the last signal
			// This maintains the previous behavior before signal merging was added
			// This can be remove when the `supportsAbortSignal` check is removed.`
			returnValue.signal = signals.at(-1);
		}
	}

	return returnValue;
};
