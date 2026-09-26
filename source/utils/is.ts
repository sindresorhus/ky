// eslint-disable-next-line @typescript-eslint/no-restricted-types
export const isObject = (value: unknown): value is object => value !== null && typeof value === 'object';

const objectToString = Object.prototype.toString;

// An `Error` from another realm (an iframe, a worker, a `vm` context, or a duplicated dependency) fails `instanceof`, so the internal brand is checked as well, the same way the request and response checks do. `instanceof` stays first because it also accepts `DOMException`, which an `AbortSignal` reason is, and that does not carry the `[object Error]` brand.
export const isError = (value: unknown): value is Error =>
	value instanceof Error || objectToString.call(value) === '[object Error]';
