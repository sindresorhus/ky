import {HTTPError} from '../errors/HTTPError.js';
import {NetworkError} from '../errors/NetworkError.js';
import {NonError} from '../errors/NonError.js';
import {ForceRetryError} from '../errors/ForceRetryError.js';
import {SchemaValidationError} from '../errors/SchemaValidationError.js';
import {TimeoutError} from '../errors/TimeoutError.js';
import type {
	Input,
	InitOptions,
	InternalOptions,
	NormalizedOptions,
	Options,
	SearchParamsInit,
	SearchParamsOption,
} from '../types/options.js';
import {type ResponsePromise} from '../types/ResponsePromise.js';
import type {StandardSchemaV1} from '../types/standard-schema.js';
import {
	cancelBody,
	limitResponseSize,
	streamRequest,
	streamResponse,
} from '../utils/body.js';
import {
	cloneDeep,
	cloneSearchParameters,
	mergeHeaders,
	mergeHeaderContainers,
	mergeHooks,
	deletedParametersSymbol,
	type MarkedSearchParameters,
} from '../utils/merge.js';
import {normalizeRequestMethod, normalizeRetryMethod, normalizeRetryOptions} from '../utils/normalize.js';
import timeout from '../utils/timeout.js';
import delay from '../utils/delay.js';
import {findUnknownOptions, hasSearchParameters} from '../utils/options.js';
import isRawNetworkError from '../utils/is-network-error.js';
import {
	isError, isNonArrayObject, isNonNegativeNumber, isObject, isRequest, isResponse,
} from '../utils/is.js';
import {
	isHTTPError, isNetworkError, isTimeoutError, isResponseSizeError, isForceRetryError,
} from '../utils/type-guards.js';
import {
	calculateRetryTimingDelay,
	getRetryTimingHeader,
} from './retry-timing.js';
import {
	maxSafeTimeout,
	responseTypes,
	getSupportedResponseTypes,
	stop,
	isRetryMarker,
	supportsAbortController,
	supportsAbortSignal,
	supportsFormData,
	supportsResponseStreams,
	supportsRequestStreams,
} from './constants.js';

const maxErrorResponseBodySize = 10 * 1024 * 1024;
const prefixUrlRenamedErrorMessage = 'The `prefixUrl` option has been renamed `prefix` in v2 and enhanced to allow slashes in input. See also the new `baseUrl` option for improved flexibility with standard URL resolution: https://github.com/sindresorhus/ky#baseurl';
const timedOut = Symbol('timedOut');

const getCurrentTime = (): number => globalThis.performance?.now() ?? Date.now();

// Settles like `promise`, or resolves with `timedOut` once `milliseconds` pass first. The timer is cleared as soon as `promise` settles.
// eslint-disable-next-line @typescript-eslint/promise-function-async
const raceWithTimeout = <T>(promise: Promise<T>, milliseconds: number): Promise<T | typeof timedOut> => Promise.race([
	promise,
	new Promise<typeof timedOut>(resolve => {
		const timeoutId = setTimeout(() => {
			resolve(timedOut);
		}, milliseconds);
		void promise.finally(() => {
			clearTimeout(timeoutId);
		}).catch(() => undefined);
	}),
]);

// Only a returned request or response has a body to release.
const cancelReturnedBody = (value: unknown): void => {
	if (isResponse(value) || isRequest(value)) {
		cancelBody(value);
	}
};

// Releases the body of a value whose owner already gave up on it, once the operation settles with something. The promise is abandoned on purpose, so its rejection is swallowed rather than surfacing as an unhandled rejection.
const releaseWhenSettled = (operationPromise: Promise<unknown>): void => {
	void operationPromise.then(value => {
		cancelReturnedBody(value);
	}).catch(() => undefined);
};

type ErrorDataTimeout = {
	milliseconds: number;
	fromTotalTimeout: boolean;
};

const createTextDecoder = (contentType: string): TextDecoder => {
	const match = /;\s*charset\s*=\s*(?:"([^"]+)"|([^;,\s]+))/i.exec(contentType);
	const charset = match?.[1] ?? match?.[2];
	if (charset) {
		try {
			return new TextDecoder(charset);
		} catch {}
	}

	return new TextDecoder();
};

const isJsonContentType = (contentType: string): boolean => {
	// Match JSON subtypes like `json`, `problem+json`, and `vnd.api+json`.
	// Written out rather than matched with a pattern like `/\/(?:.*[.+-])?json$/`, which backtracks quadratically on a `Content-Type` full of slashes. The header comes from the server, so this must stay linear.
	const mimeType = (contentType.split(';', 1)[0] ?? '').trim().toLowerCase();

	if (!mimeType.endsWith('json')) {
		return false;
	}

	const separator = mimeType.at(-5);
	if (separator === '/') {
		return true;
	}

	if (separator !== '.' && separator !== '+' && separator !== '-') {
		return false;
	}

	// The separator is not the slash, so any slash in the type comes before it.
	return mimeType.includes('/');
};

// Reads an error body as text. Returns `undefined` when the body cannot be read or is larger than `maxErrorResponseBodySize`, and `timedOut` when the read takes longer than `milliseconds`.
const readResponseText = async (response: Response, milliseconds: number): Promise<string | typeof timedOut | undefined> => {
	const {body} = response;
	if (!body) {
		try {
			return await response.text();
		} catch {
			return undefined;
		}
	}

	let reader: ReadableStreamDefaultReader<Uint8Array>;
	try {
		reader = body.getReader();
	} catch {
		// Another consumer already locked the stream.
		return undefined;
	}

	const contentType = response.headers.get('content-type') ?? '';
	// JSON uses UTF-8 regardless of the charset parameter (RFC 8259).
	const decoder = isJsonContentType(contentType) ? new TextDecoder() : createTextDecoder(contentType);
	const chunks: string[] = [];
	let totalBytes = 0;

	const readAll = (async (): Promise<string | undefined> => {
		try {
			for (;;) {
				// eslint-disable-next-line no-await-in-loop
				const {done, value} = await reader.read();
				if (done) {
					break;
				}

				totalBytes += value.byteLength;
				if (totalBytes > maxErrorResponseBodySize) {
					void reader.cancel().catch(() => undefined);
					return undefined;
				}

				chunks.push(decoder.decode(value, {stream: true}));
			}
		} catch (error) {
			if (isResponseSizeError(error)) {
				throw error;
			}

			return undefined;
		}

		chunks.push(decoder.decode());
		return chunks.join('');
	})();

	const result = await raceWithTimeout(readAll, milliseconds);
	if (result === timedOut) {
		void reader.cancel().catch(() => undefined);
	}

	return result;
};

const invalidSchemaMessage = 'The `schema` argument must follow the Standard Schema specification';
const missingResponseMessage = 'The request resolved without a response, so there is no body to read.'
	+ ' This happens when a `beforeRetry` hook returns `ky.stop`. Throw from the hook instead of returning `ky.stop`.';

// Both timeout options are milliseconds or `false`. A `NaN` or negative value used to reach `setTimeout()`, which silently clamps it to ~1ms, or to be ignored entirely when `totalTimeout` was not a number.
const validateTimeoutOption = (value: unknown, name: 'timeout' | 'totalTimeout'): void => {
	if (value === false) {
		return;
	}

	if (!isNonNegativeNumber(value)) {
		throw new TypeError(`The \`${name}\` option must be a non-negative number or \`false\``);
	}

	// `Infinity` lands here too, since it is not a usable delay either.
	if (value > maxSafeTimeout) {
		throw new RangeError(`The \`${name}\` option cannot be greater than ${maxSafeTimeout}`);
	}
};

// These callbacks are called directly, so a non-function value otherwise surfaces as a runtime error naming Ky's own internals rather than the option the caller set.
const validateCallbackOptions = (options: Record<string, unknown>): void => {
	for (const key of ['parseJson', 'stringifyJson', 'fetch', 'onDownloadProgress', 'onUploadProgress'] as const) {
		if (options[key] !== undefined && typeof options[key] !== 'function') {
			throw new TypeError(`The \`${key}\` option must be a function`);
		}
	}

	const {throwHttpErrors} = options;
	if (typeof throwHttpErrors !== 'boolean' && typeof throwHttpErrors !== 'function') {
		throw new TypeError('The `throwHttpErrors` option must be a boolean or a function');
	}
};

const leadingC0ControlOrSpacePattern = /^[\0-\u0020]+/g;
const asciiTabOrNewLinePattern = /[\t\n\r]/g;
const schemePattern = /^[a-z][\d+.a-z-]*:/i;
const malformedHttpProtocolPattern = /^https?:(?!\/\/)/i;

const isAbsoluteInput = (input: string): boolean =>
	schemePattern.test(input);

const normalizeInputForProtocolCheck = (input: string): string =>
	input.replaceAll(leadingC0ControlOrSpacePattern, '').replaceAll(asciiTabOrNewLinePattern, '');

// Joins a string input to `prefix`, then resolves it against `baseUrl`. A `URL` or `Request` input is used as-is.
const resolveInput = (input: Input, prefix: string, baseUrl: Options['baseUrl']): Input => {
	if (typeof input !== 'string') {
		return input;
	}

	if (prefix) {
		const normalizedPrefix = prefix.replace(/\/+$/, '');
		const normalizedInput = input.replace(/^\/+/, '');
		input = `${normalizedPrefix}/${normalizedInput}`;
	}

	if (baseUrl) {
		const normalizedInput = normalizeInputForProtocolCheck(input);

		if (malformedHttpProtocolPattern.test(normalizedInput)) {
			throw new TypeError('`input` url protocol must be followed by `//` when using `baseUrl`');
		}

		if (!isAbsoluteInput(normalizedInput)) {
			return new URL(input, (new Request(baseUrl)).url);
		}
	}

	return input;
};

// `URLSearchParams#delete()` serializes the whole query again even when the key is missing, which would rewrite an input URL that has nothing to remove, for example `%20` as `+`.
const deleteSearchParameter = (url: URL, key: string): void => {
	if (url.searchParams.has(key)) {
		url.searchParams.delete(key);
	}
};

// Adds the `searchParams` option to the search parameters already in `url`.
const applySearchParameters = (url: URL, searchParameters: SearchParamsOption): void => {
	const deleted = (searchParameters as MarkedSearchParameters | undefined)?.[deletedParametersSymbol];

	if (deleted) {
		// Remove keys from the input URL first so later searchParams entries can intentionally re-add them.
		for (const key of deleted) {
			deleteSearchParameter(url, key);
		}
	}

	if (typeof searchParameters === 'string') {
		const stringSearchParameters = searchParameters.replace(/^\?/, '');
		if (stringSearchParameters !== '') {
			url.search = url.search ? `${url.search}&${stringSearchParameters}` : `?${stringSearchParameters}`;
		}
	} else if (isNonArrayObject(searchParameters) && !(searchParameters instanceof URLSearchParams)) {
		// Filter out undefined values from plain objects. An `undefined` value removes the key from the input URL instead.
		for (const [key, value] of Object.entries(searchParameters)) {
			if (value === undefined) {
				deleteSearchParameter(url, key);
			} else {
				url.searchParams.append(key, value as string);
			}
		}
	} else {
		for (const [key, value] of new URLSearchParams(searchParameters as SearchParamsInit)) {
			url.searchParams.append(key, value);
		}
	}
};

// Clone mutable option properties so init hook mutations don't leak across requests. Non-plain values (functions, class instances) are kept by reference, matching how option merging treats them as whole values. A value a hook assigns is used as-is.
function cloneInitHookOptions(options: Options): InitOptions {
	const clonedOptions: Options = {
		...options,
		// `headers` starts as a plain object with lowercase names in `init` hooks, so hooks can add headers in place even when none were provided.
		headers: mergeHeaderContainers({}, options.headers ?? {}),
		// `context` starts as an object in `init` hooks, the same as in every other hook. The copy is shallow like the per-request copy, so nested values stay shared, for example a cache kept in `context`.
		context: {...options.context},
		// Deep-clone so init-hook mutations to nested values do not leak across requests, matching the nested `retry` cloning below.
		json: cloneDeep(options.json),
		searchParams: cloneSearchParameters(options.searchParams),
		// Clone nested arrays too so init hooks can mutate retry config without leaking state across requests.
		retry: cloneDeep(options.retry),
	};

	return clonedOptions as InitOptions;
}

const validateJsonWithSchema = async (jsonValue: unknown, schema: StandardSchemaV1): Promise<unknown> => {
	const standardSchema = isObject(schema) || typeof schema === 'function' ? schema['~standard'] : undefined;

	if (
		!isObject(standardSchema)
		|| typeof standardSchema.validate !== 'function'
	) {
		throw new TypeError(invalidSchemaMessage);
	}

	const validationResult = await standardSchema.validate(jsonValue);

	if (validationResult.issues) {
		throw new SchemaValidationError(validationResult.issues);
	}

	return validationResult.value;
};

export class Ky {
	static create(input: Input, options: Options): ResponsePromise {
		const initHooks = options.hooks?.init ?? [];
		const initHookOptions = initHooks.length > 0 ? cloneInitHookOptions(options) : options;

		for (const hook of initHooks) {
			hook(initHookOptions as InitOptions);
		}

		const ky = new Ky(input, initHookOptions);

		const result = (async () => {
			let response: Response | undefined;
			try {
				response = await ky.#run();
				return response;
			} catch (error: unknown) {
				return await ky.#throwProcessedError(error);
			} finally {
				const originalRequest = ky.#originalRequest;

				// Ignore cancellation errors from already-locked or already-consumed streams.
				// A custom fetch or hook can return the request body as its response body; ownership then belongs to the caller.
				cancelBody(originalRequest, response);

				// Only cancel the current request body if it's distinct from the original (i.e. it was cloned for retries). `#originalRequest` is only set once a request is handed to fetch, so a pipeline that never started, for example one where a `beforeRequest` hook threw or returned a `Response`, leaves the caller's own body alone.
				if (originalRequest && ky.request !== originalRequest) {
					cancelBody(ky.request, response);
				}
			}
		})() as ResponsePromise;

		// Only expose `.bytes()` when the environment implements it.
		for (const type of getSupportedResponseTypes()) {
			const mimeType = responseTypes[type];
			result[type] = async (schema?: StandardSchemaV1) => {
				// Before dispatch, `ky.request` is the request that will be sent. After dispatch, `#fetch()` has replaced it with the clone it prepares for a possible retry, so a late shortcut only affects later attempts. A request that was already sent is never changed, because `error.request` would then report a header that never went over the wire.
				if (ky.request !== ky.#originalRequest) {
					// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
					ky.request.headers.set('accept', ky.request.headers.get('accept') || mimeType);
				}

				const response = await result;

				// `ky.stop` from a `beforeRetry` hook resolves the request with no response at all. Reading a body method would otherwise crash deep inside Ky with a TypeError that names Ky internals.
				if (response === undefined) {
					throw new TypeError(missingResponseMessage);
				}

				if (type !== 'json') {
					return ky.#raceBodyRead(async () => response[type](), response);
				}

				const text = await ky.#raceBodyRead(async () => response.text(), response) as string;
				const request = ky.#getResponseRequest(response);
				// This implementation is shared by every body method, so its return type has to satisfy all of them. The parsed value is whatever `parseJson` or `JSON.parse` produced, which is `any` at this boundary.
				let parsedResult: any;
				try {
					parsedResult = await ky.#raceWithTotalTimeout(async () => {
						const jsonValue = text === '' && schema !== undefined && !ky.#options.parseJson
							? undefined
							: await ky.#parseJson(text, request, response);

						if (schema === undefined) {
							return jsonValue;
						}

						// eslint-disable-next-line no-return-await, @typescript-eslint/return-await -- Awaiting here preserves the caller's async stack when schema validation fails.
						return await validateJsonWithSchema(jsonValue, schema);
					});
				} catch (error: unknown) {
					// A cancellation is part of the request lifecycle, so it reaches `beforeError` like every other abort. Other failures, such as invalid JSON, stay as they are.
					if (ky.#userProvidedAbortSignal?.aborted) {
						await ky.#throwProcessedError(ky.#userProvidedAbortSignal.reason, request);
					}

					throw error;
				}

				if (parsedResult === timedOut) {
					await ky.#throwProcessedError(new TimeoutError(request), request);
				}

				return parsedResult;
			};
		}

		return result;
	}

	public request: Request;
	#abortController?: AbortController;
	#retryCount = 0;
	#retryLimit: number;
	readonly #options: InternalOptions;
	// Keep the input Request alive because Node.js stops forwarding its signal when the Request is garbage-collected.
	readonly #requestInput: Request | undefined;
	#originalRequest?: Request;
	#requestBodyCanBeCancelled = false;
	readonly #userProvidedAbortSignal: AbortSignal | undefined;
	readonly #beforeRetryHookErrors = new WeakSet<Error>();
	#cachedNormalizedOptions: NormalizedOptions | undefined;
	// When the `totalTimeout` budget runs out, or `Infinity` without a `totalTimeout`.
	readonly #deadline: number;
	// Responses returned by a `beforeRequest` or `beforeRetry` hook. They are used as-is, so a failing status throws instead of being retried.
	readonly #hookResponses = new WeakSet<Response>();
	readonly #responseRequests = new WeakMap<Response, Request>();
	readonly #decoratedResponses = new WeakSet<Response>();

	// eslint-disable-next-line complexity
	constructor(input: Input, options: Options = {}) {
		// Checked before the options are built, since building them reads `input.headers`.
		if (typeof input !== 'string' && !(input instanceof URL || input instanceof globalThis.Request)) {
			throw new TypeError('`input` must be a string, URL, or Request');
		}

		// Defaults only replace `undefined`, so a `null` reaches the validation below and is reported instead of silently becoming the default.
		const {
			maxResponseSize = Number.POSITIVE_INFINITY,
			throwHttpErrors = true,
			timeout = 10_000,
			totalTimeout = false,
			fetch = globalThis.fetch.bind(globalThis),
		} = options;
		if (Object.hasOwn(options, 'prefixUrl')) {
			throw new Error(prefixUrlRenamedErrorMessage);
		}

		// An `init` hook assigns straight onto the options object, so these are checked here, after every merge and hook. The defaults below would otherwise quietly turn a `null` into `GET`, no prefix, or the referrer of a `Request` input.
		for (const key of ['headers', 'method', 'prefix', 'baseUrl', 'referrer', 'referrerPolicy'] as const) {
			if (options[key] === null) {
				throw new TypeError(`The \`${key}\` option must not be \`null\`. Use \`undefined\` to clear it.`);
			}
		}

		if (options.context !== undefined && !isNonArrayObject(options.context)) {
			throw new TypeError('The `context` option must be an object');
		}

		this.#options = {
			...options,
			headers: mergeHeaders((input as Request).headers, options.headers),
			hooks: mergeHooks({}, options.hooks),
			method: normalizeRequestMethod(options.method ?? (input as Request).method ?? 'GET'),
			referrer: options.referrer ?? (input as Request).referrer,
			referrerPolicy: options.referrerPolicy ?? (input as Request).referrerPolicy,
			// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
			prefix: String(options.prefix || ''),
			retry: normalizeRetryOptions(options.retry),
			throwHttpErrors,
			timeout,
			totalTimeout,
			maxResponseSize,
			fetch,
			context: options.context ?? {},
		};
		// Checked here rather than on the way out, because the constructor already calls `stringifyJson`.
		validateCallbackOptions(this.#options);
		validateTimeoutOption(timeout, 'timeout');
		validateTimeoutOption(totalTimeout, 'totalTimeout');
		this.#retryLimit = this.#options.retry.limit;

		if (maxResponseSize !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(maxResponseSize) || maxResponseSize < 0)) {
			throw new TypeError('The `maxResponseSize` option must be a non-negative safe integer or Infinity');
		}

		this.#requestInput = input instanceof globalThis.Request ? input : undefined;

		input = resolveInput(input, this.#options.prefix, this.#options.baseUrl);

		if (supportsAbortController && supportsAbortSignal) {
			this.#userProvidedAbortSignal = this.#options.signal ?? this.#requestInput?.signal;
			this.#abortController = new globalThis.AbortController();
			this.#options.signal = this.#createManagedSignal();
		}

		if (supportsRequestStreams) {
			// @ts-expect-error - Types are outdated.
			this.#options.duplex = 'half';
		}

		// A `Request` input's headers are already merged in, so only a content-type from `options.headers` counts as user-provided.
		const userProvidedContentType = options.headers !== undefined && mergeHeaders({}, options.headers).has('content-type');

		if (this.#options.json !== undefined) {
			this.#options.body = this.#options.stringifyJson?.(this.#options.json) ?? JSON.stringify(this.#options.json);
			if (!userProvidedContentType) {
				this.#options.headers.set('content-type', 'application/json');
			}
		}

		// To provide correct form boundary, Content-Type header should be deleted when creating Request from another Request with FormData/URLSearchParams body
		// Only delete if user didn't explicitly provide a custom content-type
		if (
			input instanceof globalThis.Request
			&& ((supportsFormData && this.#options.body instanceof globalThis.FormData) || this.#options.body instanceof URLSearchParams)
			&& !userProvidedContentType
		) {
			this.#options.headers.delete('content-type');
		}

		this.request = new globalThis.Request(input, this.#options as RequestInit);
		this.#requestBodyCanBeCancelled = typeof globalThis.ReadableStream === 'function' && this.#options.body instanceof globalThis.ReadableStream;

		const {searchParams} = this.#options;
		if (hasSearchParameters(searchParams)) {
			const url = new URL(this.request.url);
			applySearchParameters(url, searchParams);

			// Recreate request with the updated URL. We already have all options in this.#options, including duplex.
			// Rebuilding is also what drops an inherited `Request` body, so it is skipped when the search parameters leave the URL unchanged.
			if (url.href !== this.request.url) {
				// Request options are read back from the current request so values inherited from a `Request` input (like `credentials`) survive, while explicit options already won when that request was built.
				// A `Request` input's body is only available as a stream, so keeping it requires request stream support.
				const {
					body: inheritedBody,
					cache,
					credentials,
					integrity,
					keepalive,
					mode,
					redirect,
					referrer,
					referrerPolicy,
				} = this.request;
				const canUseInheritedBody = supportsRequestStreams && !keepalive && mode !== 'no-cors';

				this.request = new globalThis.Request(url, {
					...this.#options,
					cache,
					credentials,
					integrity,
					keepalive,
					mode,
					redirect,
					referrer,
					referrerPolicy,
					body: this.#options.body ?? (canUseInheritedBody ? inheritedBody : undefined),
				} as RequestInit);
			}
		}

		// `totalTimeout` starts when the request pipeline is created, so it also includes
		// Ky's internal scheduling and user hook time before the first fetch attempt.
		this.#deadline = typeof totalTimeout === 'number' ? getCurrentTime() + totalTimeout : Number.POSITIVE_INFINITY;
	}

	async #run(): Promise<Response | undefined> {
		// Delay the fetch so that body method shortcuts can set the Accept header
		await Promise.resolve();
		const beforeRequestResponse = await this.#runBeforeRequestHooks();
		if (beforeRequestResponse !== undefined) {
			this.#retryLimit = normalizeRetryOptions(this.#options.retry).limit;
		}

		let response = beforeRequestResponse ?? await this.#retry();

		for (;;) {
			// `undefined` means a hook stopped the flow.
			if (response === undefined) {
				return undefined;
			}

			// Read before the `afterResponse` hooks run, since they can replace the response.
			const responseFromHook = this.#hookResponses.has(response);

			let retryError: Error | undefined;
			try {
				// eslint-disable-next-line no-await-in-loop
				response = await this.#runAfterResponseHooks(response);
			} catch (error) {
				if (!isForceRetryError(error)) {
					throw error;
				}

				retryError = error;
			}

			if (retryError === undefined) {
				const currentResponse: Response = response;

				// Opaque responses (`response.type === 'opaque'`) from `no-cors` requests always have `status: 0` and `ok: false`, but this is not a failure - the actual status is hidden by the browser.
				if (currentResponse.ok || currentResponse.type === 'opaque' || !this.#shouldThrowHttpErrors(currentResponse)) {
					break;
				}

				// `request` must reflect the request that actually failed, but `options` stays as Ky's
				// normalized options snapshot. Replacement `Request` instances do not preserve the
				// original `BodyInit`, so trying to make `options` mirror arbitrary requests would be lossy.
				const httpError: HTTPError = new HTTPError(currentResponse, this.#getResponseRequest(currentResponse), this.#getNormalizedOptions());
				// eslint-disable-next-line no-await-in-loop
				httpError.data = await this.#getResponseData(currentResponse);
				this.#throwIfAbortedByUser();
				this.#throwIfTotalTimeoutExhausted();

				if (responseFromHook) {
					throw httpError;
				}

				retryError = httpError;
			}

			// eslint-disable-next-line no-await-in-loop
			response = await this.#retryFromError(retryError);
		}

		this.#decorateResponse(response);

		// If `onDownloadProgress` is passed, it uses the stream API internally
		if (this.#options.onDownloadProgress) {
			if (!supportsResponseStreams) {
				throw new Error('Streams are not supported in your environment. `ReadableStream` is missing.');
			}

			const progressResponse = streamResponse(response, this.#options.onDownloadProgress);
			this.#setResponseRequest(progressResponse, this.#getResponseRequest(response));
			return this.#decorateResponse(progressResponse);
		}

		return response;
	}

	#calculateDelay(retry: InternalOptions['retry'], error: unknown): number {
		const retryDelay = retry.delay(this.#retryCount + 1);

		// A `retry.delay` that does not return a usable number would turn every delay into `NaN`, which `setTimeout()` clamps to 1ms, silently disabling the configured backoff. The `jitter` function form already guards its own result, so the input is checked here for every jitter form.
		if (!isNonNegativeNumber(retryDelay)) {
			// The failure that was being retried is chained as the cause, so `beforeError` can still inspect it instead of losing the response and data to this configuration mistake.
			throw new TypeError('`retry.delay` must return a non-negative number or `Infinity`', {cause: error});
		}

		let jitteredDelay = retryDelay;
		if (retry.jitter === true) {
			jitteredDelay = Math.random() * retryDelay;
		} else if (typeof retry.jitter === 'function') {
			jitteredDelay = retry.jitter(retryDelay);

			if (!Number.isFinite(jitteredDelay) || jitteredDelay < 0) {
				jitteredDelay = retryDelay;
			}
		}

		return Math.min(retry.backoffLimit, jitteredDelay);
	}

	async #calculateRetryDelay(error: unknown) {
		const retry = normalizeRetryOptions(this.#options.retry);
		if (this.#retryCount >= Math.min(retry.limit, this.#retryLimit)) {
			throw error;
		}

		// Wrap non-Error throws to ensure consistent error handling. `NonError.wrap()` checks with `isError` rather than `instanceof`, so a cross-realm error reaches `shouldRetry` as itself, the same way it reaches `beforeError`.
		const errorObject = NonError.wrap(error);

		// Handle forced retry from afterResponse hook - skip method check and shouldRetry
		if (isForceRetryError(errorObject)) {
			return errorObject.customDelay ?? this.#calculateDelay(retry, error);
		}

		// Check if method is retriable for non-forced retries
		if (!retry.methods.includes(normalizeRetryMethod(this.request.method))) {
			throw error;
		}

		let shouldRetryOverride = false;
		const {shouldRetry} = retry;
		if (shouldRetry !== undefined) {
			const result = await this.#raceWithTotalTimeout(async () => shouldRetry({error: errorObject, retryCount: this.#retryCount + 1}));
			this.#throwIfAbortedByUser();
			if (result === timedOut) {
				throw new TimeoutError(this.#sentRequest);
			}

			// Only exact booleans override the default retry checks.
			if (result === false) {
				throw error;
			}

			shouldRetryOverride = result === true;
		}

		// Default timeout behavior
		if (isTimeoutError(error)) {
			if (!shouldRetryOverride && !retry.retryOnTimeout) {
				throw error;
			}

			return this.#calculateDelay(retry, error);
		}

		if (isHTTPError(error)) {
			if (!shouldRetryOverride && !retry.statusCodes.includes(error.response.status)) {
				throw error;
			}

			const retryTimingHeader = getRetryTimingHeader(error.response.headers);
			if (retryTimingHeader && retry.afterStatusCodes.includes(error.response.status)) {
				const after = calculateRetryTimingDelay(retryTimingHeader);
				if (after === undefined) {
					// Malformed retry timing headers should not disable retries; they only lose their server-provided timing.
					return this.#calculateDelay(retry, error);
				}

				// Don't apply jitter when server provides explicit retry timing
				return Math.min(retry.maxRetryAfter, after);
			}

			if (!shouldRetryOverride && error.response.status === 413) {
				throw error;
			}

			return this.#calculateDelay(retry, error);
		}

		// Only retry known retriable error types. Unknown errors (e.g., programming bugs) are not retried.
		if (!shouldRetryOverride && !isNetworkError(error)) {
			throw error;
		}

		return this.#calculateDelay(retry, error);
	}

	#decorateResponse(response: Response): Response {
		if (!this.#options.parseJson || this.#decoratedResponses.has(response)) {
			return response;
		}

		this.#decoratedResponses.add(response);
		const request = this.#getResponseRequest(response);

		response.json = async () => this.#parseJson(await response.text(), request, response);

		// `clone()` returns a fresh `Response` that would otherwise fall back to the native `json()`.
		const nativeClone = response.clone.bind(response);
		response.clone = () => this.#decorateResponse(this.#setResponseRequest(nativeClone(), request));

		return response;
	}

	// Defaults to the last request that was actually sent, because `this.request` is the clone `#fetch()` prepares for a possible retry and may never be sent at all.
	async #throwProcessedError(error: unknown, request: Request = this.#sentRequest): Promise<never> {
		// Non-Error throws (e.g., thrown strings) pass through unchanged. `isError` reads the internal brand, so an error from another realm still runs the hooks, the same way the Ky type guards accept branded errors.
		if (!isError(error)) {
			throw error;
		}

		// Errors thrown by beforeRetry hooks must propagate unchanged.
		if (this.#beforeRetryHookErrors.has(error)) {
			throw error;
		}

		let processedError: Error = error;
		for (const hook of this.#options.hooks.beforeError) {
			// `options` intentionally remains the stable normalized Ky options snapshot for the same reason as `HTTPError` above.
			// eslint-disable-next-line no-await-in-loop
			const hookResult: unknown = await hook({
				request,
				options: this.#getNormalizedOptions(),
				error: processedError,
				retryCount: this.#retryCount,
			});

			// Only overwrite if the hook returns a valid Error, including one from another realm.
			if (isError(hookResult)) {
				processedError = hookResult;
			}
		}

		throw processedError;
	}

	async #getResponseData(response: Response): Promise<unknown> {
		// `request` is the request that actually produced this response, which is not `this.request` once a retry clone has been prepared.
		const request = this.#getResponseRequest(response);

		// A timed-out read or parse gives up on the data, but an exhausted `totalTimeout` still fails the request.
		const throwIfTotalTimeoutReached = ({fromTotalTimeout}: ErrorDataTimeout): void => {
			if (fromTotalTimeout) {
				throw new TimeoutError(request);
			}

			this.#throwIfTotalTimeoutExhausted(request);
		};

		// Even with request timeouts disabled, bound error-body reads so retries and error propagation
		// cannot be stalled indefinitely by never-ending response streams.
		const readTimeout = this.#getErrorDataTimeout(request);
		const text = await readResponseText(response, readTimeout.milliseconds);
		if (text === timedOut) {
			throwIfTotalTimeoutReached(readTimeout);
			return undefined;
		}

		if (!text) {
			return undefined;
		}

		if (!isJsonContentType(response.headers.get('content-type') ?? '')) {
			return text;
		}

		const parseTimeout = this.#getErrorDataTimeout(request);
		// Unparsable error data is given up on, like unreadable error data.
		const data = await raceWithTimeout(Promise.resolve().then(() => this.#parseJson(text, request, response)), parseTimeout.milliseconds).catch(() => undefined);
		if (data === timedOut) {
			throwIfTotalTimeoutReached(parseTimeout);
			return undefined;
		}

		return data;
	}

	#getErrorDataTimeout(request: Request): ErrorDataTimeout {
		const errorDataTimeout = this.#options.timeout === false ? 10_000 : this.#options.timeout;
		const remainingTotal = this.#getRemainingTotalTimeout();
		if (remainingTotal === 0) {
			throw new TimeoutError(request);
		}

		return {
			milliseconds: Math.min(errorDataTimeout, remainingTotal),
			fromTotalTimeout: remainingTotal <= errorDataTimeout,
		};
	}

	// The smaller of `timeout` and the `totalTimeout` budget left, or `undefined` when neither applies, since `setTimeout()` cannot wait forever.
	#getEffectiveTimeout(): number | undefined {
		const remainingTotal = this.#getRemainingTotalTimeout();
		if (remainingTotal === 0) {
			throw new TimeoutError(this.#sentRequest);
		}

		const effectiveTimeout = Math.min(this.#options.timeout === false ? Number.POSITIVE_INFINITY : this.#options.timeout, remainingTotal);
		return effectiveTimeout === Number.POSITIVE_INFINITY ? undefined : effectiveTimeout;
	}

	// Unlike error bodies (`#getResponseData`), a successful body read has no fallback value to return -
	// the caller's `.json()`/`.text()`/etc. promise must settle, so a timeout here always rejects.
	async #raceBodyRead(createBodyPromise: () => Promise<unknown>, response: Response): Promise<unknown> {
		const failedRequest = this.#getResponseRequest(response);
		let timeoutMilliseconds: number | undefined;
		try {
			timeoutMilliseconds = this.#getEffectiveTimeout();
		} catch (error: unknown) {
			await this.#throwProcessedError(error, failedRequest);
		}

		const bodyPromise = createBodyPromise();

		let result: unknown;
		try {
			result = timeoutMilliseconds === undefined
				? await bodyPromise
				: await raceWithTimeout(bodyPromise, timeoutMilliseconds);
		} catch (error: unknown) {
			if (this.#userProvidedAbortSignal?.aborted) {
				await this.#throwProcessedError(this.#userProvidedAbortSignal.reason, failedRequest);
			}

			if (this.#getRemainingTotalTimeout() !== 0) {
				// A connection dropped while streaming the body surfaces as a raw runtime `TypeError`. Wrap it like fetch-phase network errors so it is recognizable and runs `beforeError` hooks.
				// This only happens on the awaited path, so a body that fails after the timeout already won does not run the hooks again.
				if (isRawNetworkError(error)) {
					await this.#throwProcessedError(new NetworkError(failedRequest, {cause: error as Error}), failedRequest);
				}

				await this.#throwProcessedError(error, failedRequest);
			}

			result = timedOut;
		}

		// A cancellation is part of the request lifecycle, so it must not resolve as a successful body read just because the bytes happened to arrive first. `.json()` already gets this check for free through `#raceWithTotalTimeout()`, which is why the shortcuts used to disagree here.
		if (this.#userProvidedAbortSignal?.aborted) {
			await this.#throwProcessedError(this.#userProvidedAbortSignal.reason, failedRequest);
		}

		if (result === timedOut || this.#getRemainingTotalTimeout() === 0) {
			// The stream is locked by the native body method's own reader by this point, so
			// `response.body.cancel()` would reject as "already locked". Aborting the request's
			// signal is what actually interrupts the underlying network read.
			this.#abortController?.abort();
			await this.#throwProcessedError(new TimeoutError(failedRequest), failedRequest);
		}

		return result;
	}

	async #raceWithTotalTimeout<T>(operation: () => Promise<T>): Promise<T | typeof timedOut> {
		const abortSignal = this.#userProvidedAbortSignal;
		abortSignal?.throwIfAborted();

		const remainingTotal = this.#getRemainingTotalTimeout();
		if (remainingTotal === 0) {
			this.#abortController?.abort();
			return timedOut;
		}

		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		let abortListener: (() => void) | undefined;
		let operationPromise: Promise<T> | undefined;
		try {
			const abortPromise = new Promise<never>((_resolve, reject) => {
				if (!abortSignal) {
					return;
				}

				abortListener = () => {
					// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- AbortSignal reasons can be any value and must be preserved exactly.
					reject(abortSignal.reason);
				};

				// The signal was checked above, and nothing ran since, so it cannot have aborted before the listener is added.
				abortSignal.addEventListener('abort', abortListener, {once: true});
			});
			operationPromise = operation();

			if (remainingTotal === Number.POSITIVE_INFINITY) {
				return await Promise.race([operationPromise, abortPromise]);
			}

			const timeoutPromise = new Promise<typeof timedOut>(resolve => {
				timeoutId = setTimeout(() => {
					resolve(timedOut);
				}, remainingTotal);
			});
			const result = await Promise.race([operationPromise, timeoutPromise, abortPromise]);
			if (result === timedOut || this.#getRemainingTotalTimeout() === 0) {
				this.#abortController?.abort();

				if (result === timedOut) {
					releaseWhenSettled(operationPromise);
				} else {
					cancelReturnedBody(result);
				}

				return timedOut;
			}

			return result;
		} catch (error: unknown) {
			if (abortSignal?.aborted) {
				// The abort won the race, so whatever the operation eventually returns is discarded. Release its body, the same way the timeout path above does for a value it never consumed.
				if (operationPromise) {
					releaseWhenSettled(operationPromise);
				}

				abortSignal.throwIfAborted();
			}

			if (this.#getRemainingTotalTimeout() === 0) {
				this.#abortController?.abort();
				return timedOut;
			}

			throw error;
		} finally {
			clearTimeout(timeoutId);
			if (abortListener) {
				abortSignal?.removeEventListener('abort', abortListener);
			}
		}
	}

	// Uses `parseJson` when it is set, and `JSON.parse()` otherwise.
	#parseJson(text: string, request: Request, response: Response): unknown {
		const {parseJson} = this.#options;
		return parseJson ? parseJson(text, {request, response}) : JSON.parse(text);
	}

	#createManagedSignal(): AbortSignal {
		return this.#userProvidedAbortSignal
			? AbortSignal.any([this.#userProvidedAbortSignal, this.#abortController!.signal])
			: this.#abortController!.signal;
	}

	// A `throwHttpErrors` predicate that throws used to escape from the `if` condition, before the body was read or released, leaving the caller with an error and no handle on the response to release it with.
	#shouldThrowHttpErrors(response: Response): boolean {
		const {throwHttpErrors} = this.#options;
		try {
			return typeof throwHttpErrors === 'function' ? throwHttpErrors(response.status) : throwHttpErrors;
		} catch (error: unknown) {
			cancelBody(response);
			throw error;
		}
	}

	// `#fetch()` replaces `this.request` with the clone it prepares for a possible retry, so anything reporting the request that produced a response or failed has to use the one that was actually sent.
	get #sentRequest(): Request {
		return this.#originalRequest ?? this.request;
	}

	#throwIfTotalTimeoutExhausted(request: Request = this.#sentRequest): void {
		if (this.#getRemainingTotalTimeout() === 0) {
			throw new TimeoutError(request);
		}
	}

	async #runBeforeRequestHooks(): Promise<Response | undefined> {
		for (const hook of this.#options.hooks.beforeRequest) {
			// eslint-disable-next-line no-await-in-loop
			const result = await this.#raceWithTotalTimeout(async () => hook({
				request: this.request,
				options: this.#getNormalizedOptions(),
				retryCount: 0,
			}));

			if (result === timedOut) {
				throw new TimeoutError(this.#sentRequest);
			}

			if (isRequest(result)) {
				this.#assignRequest(this.#withManagedSignal(result));
			} else if (isResponse(result)) {
				this.#hookResponses.add(result);
				return result;
			}
		}

		return undefined;
	}

	async #runAfterResponseHooks(response: Response): Promise<Response> {
		const responseRequest = this.#getResponseRequest(response);
		response = this.#limitResponseSize(response);

		for (const hook of this.#options.hooks.afterResponse) {
			const hookResponse = this.#setResponseRequest(response.clone(), responseRequest);
			this.#decorateResponse(hookResponse);

			let modifiedResponse;
			try {
				// eslint-disable-next-line no-await-in-loop
				modifiedResponse = await this.#raceWithTotalTimeout(async () => hook({
					// Deliberately `this.request`, which `#fetch()` has already replaced with the clone prepared for a retry, so its body is still unread. A hook that forces a retry with `ky.retry({request: new Request(request)})` depends on being able to copy an unconsumed request from here.
					request: this.request,
					options: this.#getNormalizedOptions(),
					response: hookResponse,
					retryCount: this.#retryCount,
				}));

				if (modifiedResponse === timedOut) {
					throw new TimeoutError(this.#sentRequest);
				}

				if (isRetryMarker(modifiedResponse)) {
					throw new ForceRetryError(modifiedResponse.options);
				}
			} catch (error) {
				// Cancel both the cloned response passed to the hook and the current response to prevent memory leaks when a hook throws, times out, or forces a retry (especially important in Deno/Bun).
				// Do not await cancellation since hooks can clone the response, leaving extra tee branches that keep cancel promises pending per the Streams spec.
				cancelBody(hookResponse);
				cancelBody(response);
				throw error;
			}

			const nextResponse = isResponse(modifiedResponse)
				? this.#setResponseRequest(modifiedResponse, responseRequest)
				: response;

			// Cancel any response bodies we won't use to prevent memory leaks.
			// Uses fire-and-forget since hooks may have cloned the response, creating tee branches that block cancellation.
			// If the hook wrapped an existing body into a new Response, both Response objects can still point at the same stream.
			cancelBody(hookResponse, nextResponse);
			cancelBody(response, nextResponse);

			if (nextResponse !== response) {
				response = this.#limitResponseSize(nextResponse);
			}
		}

		return response;
	}

	async #retry(): Promise<Response | void> {
		try {
			return await this.#fetch();
		} catch (error) {
			return this.#retryFromError(error);
		}
	}

	async #retryFromError(error: unknown): Promise<Response | void> {
		this.#throwIfAbortedByUser();

		const retryDelay = Math.min(await this.#calculateRetryDelay(error), maxSafeTimeout);
		const delayOptions = {signal: this.#userProvidedAbortSignal};

		const remainingTimeout = this.#getRemainingTotalTimeout();
		if (remainingTimeout === 0) {
			throw new TimeoutError(this.#sentRequest);
		}

		// If waiting would consume all remaining budget, time out without starting another request.
		if (retryDelay >= remainingTimeout) {
			await delay(remainingTimeout, delayOptions);
			throw new TimeoutError(this.#sentRequest);
		}

		// Only use user-provided signal for delay, not our internal abortController
		await delay(retryDelay, delayOptions);

		this.#throwIfTotalTimeoutExhausted();

		// Reset abortController if it was aborted (happens on timeout retry) so hooks and the retried request get a fresh signal
		if (this.#abortController?.signal.aborted) {
			this.#abortController = new globalThis.AbortController();
			this.#options.signal = this.#createManagedSignal();
			this.#assignRequest(this.#withManagedSignal(this.request), this.#requestBodyCanBeCancelled);
		}

		// Apply custom request from forced retry before beforeRetry hooks
		// Ensure the custom request has the correct managed signal for timeouts and user aborts
		if (isForceRetryError(error) && error.customRequest) {
			// Replacement Requests are authoritative by design. Do not rewrite headers here,
			// even for cross-origin retries. Callers using `ky.retry({request})` explicitly
			// opted into the exact Request they constructed.
			this.#assignRequest(this.#withManagedSignal(error.customRequest));
		}

		for (const hook of this.#options.hooks.beforeRetry) {
			let hookResult: Awaited<ReturnType<typeof hook>> | typeof timedOut;
			try {
				// eslint-disable-next-line no-await-in-loop
				hookResult = await this.#raceWithTotalTimeout(async () => hook({
					request: this.request,
					options: this.#getNormalizedOptions(),
					error: NonError.wrap(error),
					retryCount: this.#retryCount + 1,
				}));
			} catch (hookError) {
				// A cancellation is part of the request lifecycle, so it reaches `beforeError` like every other abort rather than being hidden as a hook error below.
				this.#throwIfAbortedByUser();

				// Preserve the original request error path (`throw error`) so beforeError hooks can still run. `isError` rather than `instanceof`, so a cross-realm error is recognised the same way `#throwProcessedError` does.
				if (isError(hookError) && hookError !== error) {
					this.#beforeRetryHookErrors.add(hookError);
				}

				throw hookError;
			}

			if (hookResult === timedOut) {
				throw new TimeoutError(this.#sentRequest);
			}

			if (isRequest(hookResult)) {
				// Same contract as `ky.retry({request})`: a Request returned from `beforeRetry`
				// is used as-is rather than being sanitized or otherwise rewritten by Ky.
				this.#assignRequest(this.#withManagedSignal(hookResult));
				break;
			}

			if (isResponse(hookResult)) {
				this.#hookResponses.add(hookResult);
				this.#retryCount++;
				return hookResult;
			}

			// If `stop` is returned from the hook, the retry process is stopped
			if (hookResult === stop) {
				return;
			}
		}

		this.#throwIfTotalTimeoutExhausted();

		this.#retryCount++;
		return this.#retry();
	}

	async #fetch(): Promise<Response> {
		// A previous attempt can return without consuming its upload. Release that unused branch before replacing the request reference.
		cancelBody(this.#originalRequest, this.request);

		const nonRequestOptions = findUnknownOptions(this.#options);
		this.#retryLimit = normalizeRetryOptions(this.#options.retry).limit;
		// Reattach the managed signal because Node.js can garbage-collect the abort controller used by Request.clone().
		const retryRequest = this.#retryLimit > 0 ? this.#withManagedSignal(this.request.clone()) : undefined;
		const request = this.#wrapRequestWithUploadProgress(this.request);

		// Cloning is done here to prepare in advance for retries.
		// Skip cloning when retries are disabled - cloning a streaming body calls ReadableStream#tee()
		// which buffers the entire stream in memory, causing excessive memory usage for large uploads.
		this.#originalRequest = request;
		if (retryRequest) {
			this.request = retryRequest;
			this.#requestBodyCanBeCancelled = true;
		}

		try {
			const effectiveTimeout = this.#getEffectiveTimeout();

			// Called unbound so a native `window.fetch` is not invoked with the options object as `this`, which throws "Illegal invocation" in browsers.
			const {fetch} = this.#options;
			const response = effectiveTimeout === undefined
				? await fetch(request, nonRequestOptions)
				: await timeout(request, nonRequestOptions, this.#abortController, {
					timeout: effectiveTimeout,
					fetch,
				});

			// `undefined` would otherwise look like `ky.stop`, and any other value fails later with an error that does not name the cause.
			if (!isResponse(response)) {
				throw new TypeError('The `fetch` option must resolve with a `Response`');
			}

			if (this.#getRemainingTotalTimeout() === 0) {
				this.#abortController?.abort();
				cancelBody(response);
				throw new TimeoutError(request);
			}

			return this.#setResponseRequest(response, request);
		} catch (error) {
			this.#throwIfAbortedByUser();
			if (this.#getRemainingTotalTimeout() === 0) {
				this.#abortController?.abort();
				throw new TimeoutError(request);
			}

			if (isRawNetworkError(error)) {
				throw new NetworkError(request, {cause: error as Error});
			}

			throw error;
		}
	}

	// Chromium reports a user abort during a fetch or body read as `TypeError: Failed to fetch`, which would otherwise be mistaken for a dropped connection. Surface the abort reason instead, like other runtimes do.
	#throwIfAbortedByUser(): void {
		this.#userProvidedAbortSignal?.throwIfAborted();
	}

	// `0` once the `totalTimeout` budget is spent, and `Infinity` without a `totalTimeout`.
	#getRemainingTotalTimeout(): number {
		return Math.max(0, this.#deadline - getCurrentTime());
	}

	#getNormalizedOptions(): NormalizedOptions {
		if (!this.#cachedNormalizedOptions) {
			// Exclude Ky-specific options that are not part of `RequestInit`.
			const {
				hooks,
				json,
				parseJson,
				stringifyJson,
				searchParams,
				timeout,
				totalTimeout,
				maxResponseSize,
				throwHttpErrors,
				fetch,
				...normalizedOptions
			} = this.#options;

			this.#cachedNormalizedOptions = Object.freeze(normalizedOptions) as NormalizedOptions;
		}

		return this.#cachedNormalizedOptions;
	}

	#assignRequest(request: Request, requestBodyCanBeCancelled = false): void {
		// Runtime-derived bodies such as `FormData` may still be serialized after a hook constructs a replacement Request, so only caller-provided streams and Ky's own prepared retry clones are safe to cancel here.
		if (this.#requestBodyCanBeCancelled) {
			cancelBody(this.request, request);
		}

		this.#cachedNormalizedOptions = undefined;
		this.request = request;
		this.#requestBodyCanBeCancelled = requestBodyCanBeCancelled;
	}

	// A replacement `Request` from a hook or `ky.retry({request})` carries its own signal, so re-attach Ky's managed signal to keep timeouts and user aborts working. Request-like objects are used as-is since the `Request` constructor cannot copy them, so they keep whatever signal they carry, even on a retry after a timeout.
	#withManagedSignal(request: Request): Request {
		if (!this.#options.signal || !(request instanceof globalThis.Request)) {
			return request;
		}

		return new globalThis.Request(request, {
			signal: this.#options.signal,
			referrer: request.referrer,
			referrerPolicy: request.referrerPolicy,
		});
	}

	// A response Ky did not fetch, such as one returned from a `beforeRetry` hook, is reported with the last request that was sent, like every error is.
	#getResponseRequest(response: Response): Request {
		return this.#responseRequests.get(response) ?? this.#sentRequest;
	}

	#setResponseRequest(response: Response, request: Request): Response {
		this.#responseRequests.set(response, request);
		return response;
	}

	#limitResponseSize(response: Response): Response {
		const request = this.#getResponseRequest(response);
		return this.#setResponseRequest(limitResponseSize(response, request, this.#options.maxResponseSize), request);
	}

	#wrapRequestWithUploadProgress(request: Request): Request {
		if (!this.#options.onUploadProgress || !supportsRequestStreams || !request.body) {
			return request;
		}

		return streamRequest(request, this.#options.onUploadProgress, this.#options.body);
	}
}
