import type {KyHeadersInit, Options} from '../types/options';
import type {Hooks} from '../types/hooks';
import {isObject} from './is';

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

	for (const source of sources) {
		if (Array.isArray(source)) {
			if (!Array.isArray(returnValue)) {
				returnValue = [];
			}

			returnValue = [...returnValue, ...source];
		} else if (isObject(source)) {
			for (let [key, value] of Object.entries(source)) {
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

	return returnValue;
};
