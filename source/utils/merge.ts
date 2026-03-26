import type {KyHeadersInit, Options} from '../types/options.js';
import type {Hooks} from '../types/hooks.js';
import {supportsAbortSignal} from '../core/constants.js';
import {isObject} from './is.js';

const replaceSymbol: unique symbol = Symbol('replaceOption');

type ReplaceMarked<T> = {
	[replaceSymbol]: true;
	value: T;
};

type ReplaceState<T> = {
	isReplace: boolean;
	value: T;
};

const getReplaceState = <T>(value: T): ReplaceState<T> =>
	isObject(value) && (value as any)[replaceSymbol] === true
		? {
			isReplace: true,
			value: (value as unknown as ReplaceMarked<T>).value,
		}
		: {
			isReplace: false,
			value,
		};

/**
Wraps a value so that `ky.extend()` will replace the parent value instead of merging with it.

By default, `.extend()` deep-merges options with the parent instance: hooks get appended, headers get merged, and search parameters get accumulated. Use `replaceOption` when you want to fully replace a merged property instead.

@example
```
import ky, {replaceOption} from 'ky';

const base = ky.create({
	hooks: {beforeRequest: [addAuth, addTracking]},
});

// Replaces instead of appending
const extended = base.extend({
	hooks: replaceOption({beforeRequest: [onlyThis]}),
});
// hooks.beforeRequest is now [onlyThis], not [addAuth, addTracking, onlyThis]
```
*/
export const replaceOption = <T>(value: T): T => {
	const markedValue: ReplaceMarked<T> = {[replaceSymbol]: true, value};
	return markedValue as unknown as T;
};

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

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (!isObject(value) || Array.isArray(value)) {
		return false;
	}

	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

export const cloneShallow = <T>(value: T): T => {
	if (value instanceof URLSearchParams) {
		return new URLSearchParams(value) as T;
	}

	if (value instanceof globalThis.Headers) {
		return new globalThis.Headers(value) as T;
	}

	if (Array.isArray(value)) {
		return [...value] as T;
	}

	if (isPlainObject(value)) {
		const copy = {...value};
		return copy as T;
	}

	return value;
};

const normalizeHeaderObject = (headers: Record<string, string | undefined>): Record<string, string> =>
	Object.fromEntries(
		Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined),
	);

const mergeHeaderContainers = (source1: KyHeadersInit, source2: KyHeadersInit): KyHeadersInit => {
	if (isPlainObject(source1) && isPlainObject(source2)) {
		return normalizeHeaderObject({...source1, ...source2});
	}

	return mergeHeaders(source1, source2);
};

function newHookValue<K extends keyof Hooks>(original: Hooks, incoming: Hooks, property: K): Required<Hooks>[K] {
	return (Object.hasOwn(incoming, property) && incoming[property] === undefined)
		? []
		: deepMerge<Required<Hooks>[K]>(original[property] ?? [], incoming[property] ?? []);
}

export const mergeHooks = (original: Hooks = {}, incoming: Hooks = {}): Required<Hooks> => (
	{
		init: newHookValue(original, incoming, 'init'),
		beforeRequest: newHookValue(original, incoming, 'beforeRequest'),
		beforeRetry: newHookValue(original, incoming, 'beforeRetry'),
		beforeError: newHookValue(original, incoming, 'beforeError'),
		afterResponse: newHookValue(original, incoming, 'afterResponse'),
	}
);

const appendSearchParameters = (target: any, source: any): URLSearchParams => {
	const result = new URLSearchParams();

	for (const input of [target, source]) {
		if (input === undefined) {
			continue;
		}

		if (input instanceof URLSearchParams) {
			for (const [key, value] of input.entries()) {
				result.append(key, value);
			}
		} else if (Array.isArray(input)) {
			for (const pair of input) {
				if (!Array.isArray(pair) || pair.length !== 2) {
					throw new TypeError('Array search parameters must be provided in [[key, value], ...] format');
				}

				result.append(String(pair[0]), String(pair[1]));
			}
		} else if (isObject(input)) {
			for (const [key, value] of Object.entries(input)) {
				if (value !== undefined) {
					result.append(key, String(value));
				}
			}
		} else {
			// String
			const parameters = new URLSearchParams(input);
			for (const [key, value] of parameters.entries()) {
				result.append(key, value);
			}
		}
	}

	return result;
};

// TODO: Make this strongly-typed (no `any`).
export const deepMerge = <T>(...sources: Array<Partial<T> | undefined>): T => {
	let returnValue: any = {};
	let headers: KyHeadersInit = {};
	let hooks = {};
	let searchParameters: any;
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

				const replaceState = getReplaceState(value);
				const {isReplace} = replaceState;
				value = replaceState.value;

				// Special handling for context - shallow merge only
				if (key === 'context') {
					if (value !== undefined && value !== null && (!isObject(value) || Array.isArray(value))) {
						throw new TypeError('The `context` option must be an object');
					}

					// Shallow merge: always create a new object to prevent mutation bugs
					returnValue = {
						...returnValue,
						context: (value === undefined || value === null)
							? {}
							: (isReplace
								? {...value}
								: {...returnValue.context, ...value}),
					};
					continue;
				}

				// Special handling for searchParams
				if (key === 'searchParams') {
					if (value === undefined || value === null) {
						// Explicit undefined or null removes searchParams
						searchParameters = undefined;
					} else if (isReplace) {
						searchParameters = value;
					} else {
						// First source: keep as-is to preserve type (string/object/URLSearchParams)
						// Subsequent sources: merge and convert to URLSearchParams
						searchParameters = searchParameters === undefined ? value : appendSearchParameters(searchParameters, value);
					}

					continue;
				}

				if (isObject(value) && !isReplace && key in returnValue) {
					value = deepMerge(returnValue[key], value);
				}

				returnValue = {...returnValue, [key]: value};
			}

			if (isObject((source as any).hooks)) {
				const {value: hookValue, isReplace} = getReplaceState((source as any).hooks);
				hooks = isReplace
					? mergeHooks({}, hookValue)
					: mergeHooks(hooks, hookValue);

				returnValue.hooks = hooks;
			}

			if (isObject((source as any).headers)) {
				const {value: headerValue, isReplace} = getReplaceState((source as any).headers);
				headers = isReplace
					? cloneShallow(headerValue as KyHeadersInit)
					: mergeHeaderContainers(headers, headerValue as KyHeadersInit);

				returnValue.headers = headers;
			}
		}
	}

	if (searchParameters !== undefined) {
		returnValue.searchParams = searchParameters;
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
