import {HTTPMethod} from '../types/options.js';

export const supportsAbortController = typeof globalThis.AbortController === 'function';
export const supportsStreams = typeof globalThis.ReadableStream === 'function';
export const supportsFormData = typeof globalThis.FormData === 'function';

export const requestMethods: readonly HTTPMethod[] = ['get', 'post', 'put', 'patch', 'head', 'delete'];

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
