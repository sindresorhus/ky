import type { Expect, Equal } from '@type-challenges/utils';
import {HTTPMethod} from '../types/options.js';

export const supportsAbortController = typeof globalThis.AbortController === 'function';
export const supportsStreams = typeof globalThis.ReadableStream === 'function';
export const supportsFormData = typeof globalThis.FormData === 'function';

export const requestMethods = ['get', 'post', 'put', 'patch', 'head', 'delete'] as const;

type cases = [
	Expect<Equal<typeof requestMethods[number], HTTPMethod>>,
]

export const responseTypes = {
	json: 'application/json',
	text: 'text/*',
	formData: 'multipart/form-data',
	arrayBuffer: '*/*',
	blob: '*/*'
} as const;

// The maximum value of a 32bit int (see issue #117)
export const maxSafeTimeout = 2147483647;

export const stop = Symbol('stop');
