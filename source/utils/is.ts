// eslint-disable-next-line @typescript-eslint/no-restricted-types
export const isObject = (value: unknown): value is object => value !== null && typeof value === 'object';

// eslint-disable-next-line @typescript-eslint/no-restricted-types
export const isNonArrayObject = (value: unknown): value is object => isObject(value) && !Array.isArray(value);

// `NaN` fails the comparison, so it is rejected too.
export const isNonNegativeNumber = (value: unknown): value is number => typeof value === 'number' && value >= 0;

const objectToString = Object.prototype.toString;

// An `Error` from another realm (an iframe, a worker, a `vm` context, or a duplicated dependency) fails `instanceof`, so the internal brand is checked as well, the same way the request and response checks do. `instanceof` stays first because it also accepts `DOMException`, which an `AbortSignal` reason is, and that does not carry the `[object Error]` brand.
export const isError = (value: unknown): value is Error =>
	value instanceof Error || objectToString.call(value) === '[object Error]';

// A `Request` from another realm, such as one a hook built in an iframe, is accepted through its internal brand.
export const isRequest = (value: unknown): value is Request =>
	value instanceof globalThis.Request || objectToString.call(value) === '[object Request]';

// Accepted custom responses are treated as full Responses throughout Ky.
// If a custom fetch returns one, it must behave like a Response for cloning,
// body consumption, `json()` decoration, and any enabled stream features.
export const isResponse = (value: unknown): value is Response =>
	value instanceof globalThis.Response || objectToString.call(value) === '[object Response]';
