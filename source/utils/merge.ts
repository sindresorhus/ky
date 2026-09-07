import type {KyHeadersInit, Options} from '../types/options.js';
import type {Hooks, NormalizedHooks} from '../types/hooks.js';
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
Wraps a value so that `ky.extend()` will replace the parent value instead of merging with it. Works with hooks, headers, search parameters, context, and any other deep-merged option.

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
	// The base source is copied as-is. Only the second source carries deletion markers: `undefined` in a plain object (for example, from `init` hooks or merged options), or the string `'undefined'` in a `Headers` instance.
	const result = new globalThis.Headers(source1 as RequestInit['headers']);

	for (const [key, value] of Object.entries(toHeaderObject(source2))) {
		if (value === undefined) {
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

// Only plain objects and arrays are merged. Class instances (for example, a `Date` in `json` or an undici `Agent` in `dispatcher`) are replaced as a whole, since merging their own properties into a plain object would strip their prototype.
const isMergeable = (value: unknown): value is Record<string, unknown> | unknown[] => isPlainObject(value) || Array.isArray(value);

export const cloneShallow = <T>(value: T): T => {
	if (value instanceof URLSearchParams) {
		const copy = new URLSearchParams(value) as URLSearchParams & {[deletedParametersSymbol]?: Set<string>};
		const deleted = (value as URLSearchParams & {[deletedParametersSymbol]?: Set<string>})[deletedParametersSymbol];
		if (deleted) {
			// Preserve internal deletion markers so init-hook cloning does not resurrect params removed during option merging.
			copy[deletedParametersSymbol] = new Set(deleted);
		}

		return copy as T;
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

// Header names are case-insensitive, so they are normalized to lowercase (like `Headers` does) so that overrides and `undefined` deletions match regardless of how the name was spelled and `init` hooks can rely on lowercase keys.
// An `undefined` value is kept as a deletion marker so it can still remove a header inherited from a `Request` input when the request is created.
const mergeHeaderObjects = (source1: Record<string, unknown>, source2: Record<string, unknown>): Record<string, string | undefined> => {
	const result = new Map<string, string | undefined>();

	for (const [key, value] of [...Object.entries(source1), ...Object.entries(source2)]) {
		result.set(key.toLowerCase(), value as string | undefined);
	}

	return Object.fromEntries(result);
};

// Every header source is merged as a plain object so deletion markers survive no matter how the headers were provided. A `Headers` instance cannot hold `undefined`, so its string `'undefined'` counts as a deletion. A plain object is returned as-is, so callers must not mutate the result.
const toHeaderObject = (source: KyHeadersInit): Record<string, string | undefined> => {
	if (isPlainObject(source)) {
		return source as Record<string, string | undefined>;
	}

	const isHeadersInstance = source instanceof globalThis.Headers;
	const result: Record<string, string | undefined> = {};

	// A header named `__proto__` is dropped here, because assigning it sets the prototype instead of an own property. This is too much of an edge case to be worth supporting.
	for (const [key, value] of new globalThis.Headers(source as RequestInit['headers']).entries()) {
		result[key] = isHeadersInstance && value === 'undefined' ? undefined : value;
	}

	return result;
};

const mergeHeaderContainers = (source1: KyHeadersInit, source2: KyHeadersInit): Record<string, string | undefined> =>
	mergeHeaderObjects(toHeaderObject(source1), toHeaderObject(source2));

function newHookValue<K extends keyof Hooks>(original: Hooks, incoming: Hooks, property: K): NormalizedHooks[K] {
	if (Object.hasOwn(incoming, property) && incoming[property] === undefined) {
		return [];
	}

	// A single hook type can be wrapped in `replaceOption()` to replace only that array instead of the whole `hooks` object.
	const {isReplace, value} = getReplaceState(incoming[property]);
	if (isReplace) {
		return [...(value ?? [])] as NormalizedHooks[K];
	}

	return deepMerge<NormalizedHooks[K]>(original[property] ?? [], value ?? []);
}

export const mergeHooks = (original: Hooks = {}, incoming: Hooks = {}): NormalizedHooks => (
	{
		init: newHookValue(original, incoming, 'init'),
		beforeRequest: newHookValue(original, incoming, 'beforeRequest'),
		beforeRetry: newHookValue(original, incoming, 'beforeRetry'),
		beforeError: newHookValue(original, incoming, 'beforeError'),
		afterResponse: newHookValue(original, incoming, 'afterResponse'),
	}
);

export const deletedParametersSymbol = Symbol('deletedParameters');

const appendSearchParameters = (target: any, source: any): URLSearchParams => {
	const result = new URLSearchParams() as URLSearchParams & {[deletedParametersSymbol]?: Set<string>};
	// Deleted keys stay marked even when a later layer re-adds the key, so the key is still removed from the input URL before the re-added value is appended.
	const deleted = new Set<string>();

	for (const input of [target, source]) {
		if (input === undefined) {
			continue;
		}

		if (input instanceof URLSearchParams) {
			// A merged `URLSearchParams` already applied its own deletions before any re-added entries, so its deletions only apply to what was merged before it.
			const inputDeleted = (input as any)[deletedParametersSymbol] as Set<string> | undefined;
			if (inputDeleted) {
				for (const key of inputDeleted) {
					result.delete(key);
					deleted.add(key);
				}
			}

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
				if (value === undefined) {
					result.delete(key);
					deleted.add(key);
				} else {
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

	if (deleted.size > 0) {
		result[deletedParametersSymbol] = deleted;
	}

	return result;
};

// TODO: Make this strongly-typed (no `any`).
const deepMergeInternal = <T>(isRoot: boolean, ...sources: Array<Partial<T> | undefined>): T => {
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
				const replaceState = getReplaceState(value);
				const {isReplace} = replaceState;
				value = replaceState.value;

				const isRootSignal = isRoot && key === 'signal';
				if (isRootSignal && (isReplace || value === undefined)) {
					signals.length = 0;
				}

				// Special handling for AbortSignal instances at the root options level
				if (isRootSignal && value instanceof globalThis.AbortSignal) {
					signals.push(value);
					continue;
				}

				// Special handling for context - shallow merge only.
				// Scoped to the root options level so it never rewrites nested user data that
				// happens to contain a `context` key (e.g. a `json` request body).
				if (isRoot && key === 'context') {
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

				// Special handling for searchParams.
				// Scoped to the root options level so it never rewrites nested user data that
				// happens to contain a `searchParams` key (e.g. a `json` request body).
				if (isRoot && key === 'searchParams') {
					if (value === undefined || value === null) {
						// Explicit undefined or null removes searchParams
						searchParameters = undefined;
					} else if (isReplace) {
						searchParameters = value;
					} else {
						// First source: shallow-clone to preserve type (string/object/URLSearchParams) without sharing the caller's object
						// Subsequent sources: merge and convert to URLSearchParams
						searchParameters = searchParameters === undefined ? cloneShallow(value) : appendSearchParameters(searchParameters, value);
					}

					continue;
				}

				// `retry` accepts a number as shorthand for `{limit: number}`. Expand it before
				// merging so extending a numeric `retry` with an object keeps the limit instead
				// of dropping it (e.g. `ky.create({retry: 3}).extend({retry: {methods: ['get']}})`),
				// and extending an object `retry` with a number keeps the other options
				// (e.g. `ky.create({retry: {methods: ['post']}}).extend({retry: 3})`).
				// Scoped to the root options level so it never rewrites nested user data that
				// happens to contain a `retry` key (e.g. a `json` request body).
				if (isRoot && key === 'retry' && !isReplace) {
					if (isObject(value) && typeof returnValue[key] === 'number') {
						returnValue = {...returnValue, [key]: {limit: returnValue[key]}};
					} else if (typeof value === 'number' && isObject(returnValue[key])) {
						value = {limit: value};
					}
				}

				if (!isReplace && isMergeable(returnValue[key]) && isMergeable(value)) {
					value = deepMergeInternal<unknown>(false, returnValue[key], value);
				}

				returnValue = {...returnValue, [key]: value};
			}

			// Scoped to the root options level so it never rewrites nested user data that
			// happens to contain a `hooks` key (e.g. a `json` request body).
			if (isRoot && isObject((source as any).hooks)) {
				const {value: hookValue, isReplace} = getReplaceState((source as any).hooks);
				hooks = isReplace
					? mergeHooks({}, hookValue)
					: mergeHooks(hooks, hookValue);

				returnValue.hooks = hooks;
			}

			// Scoped to the root options level so it never rewrites nested user data that
			// happens to contain a `headers` key (e.g. a `json` request body).
			if (isRoot && isObject((source as any).headers)) {
				const {value: headerValue, isReplace} = getReplaceState((source as any).headers);
				headers = mergeHeaderContainers(isReplace ? {} : headers, headerValue as KyHeadersInit);

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
			// This can be removed when the `supportsAbortSignal` check is removed.
			returnValue.signal = signals.at(-1);
		}
	}

	return returnValue;
};

export const deepMerge = <T>(...sources: Array<Partial<T> | undefined>): T =>
	deepMergeInternal<T>(true, ...sources);
