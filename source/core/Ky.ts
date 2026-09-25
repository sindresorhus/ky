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
	KyHeadersInit,
	NormalizedOptions,
	Options,
	SearchParamsInit,
	SearchParamsOption,
} from '../types/options.js';
import {type ResponsePromise} from '../types/ResponsePromise.js';
import type {StandardSchemaV1} from '../types/standard-schema.js';
import {
	getProgressCallbackError,
	limitResponseSize,
	streamRequest,
	streamResponse,
} from '../utils/body.js';
import {
	cloneShallow,
	cloneDeep,
	mergeHeaders,
	mergeHeaderContainers,
	mergeHooks,
	deletedParametersSymbol,
} from '../utils/merge.js';
import type {RetryOptions} from '../types/retry.js';
import {normalizeRequestMethod, normalizeRetryMethod, normalizeRetryOptions} from '../utils/normalize.js';
import timeout from '../utils/timeout.js';
import delay from '../utils/delay.js';
import {type ObjectEntries} from '../utils/types.js';
import {findUnknownOptions, hasSearchParameters} from '../utils/options.js';
import isRawNetworkError from '../utils/is-network-error.js';
import {
	isHTTPError, isNetworkError, isTimeoutError, isResponseSizeError,
} from '../utils/type-guards.js';
import {
	calculateRetryTimingDelay,
	getRetryTimingHeader,
} from './retry-timing.js';
import {
	maxSafeTimeout,
	responseTypes,
	stop,
	RetryMarker,
	supportsAbortController,
	supportsAbortSignal,
	supportsFormData,
	supportsResponseStreams,
	supportsRequestStreams,
} from './constants.js';

const maxErrorResponseBodySize = 10 * 1024 * 1024;
const prefixUrlRenamedErrorMessage = 'The `prefixUrl` option has been renamed `prefix` in v2 and enhanced to allow slashes in input. See also the new `baseUrl` option for improved flexibility with standard URL resolution: https://github.com/sindresorhus/ky#baseurl';
const timedOutResponseData = Symbol('timedOutResponseData');
const timedOutOperation = Symbol('timedOutOperation');

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

const invalidSchemaMessage = 'The `schema` argument must follow the Standard Schema specification';

// Both timeout options are milliseconds or `false`. A non-finite or negative value used to reach `setTimeout()`,
// which silently clamps it to ~1ms, or to be ignored entirely when `totalTimeout` was not a number.
const validateTimeoutOption = (value: unknown, name: 'timeout' | 'totalTimeout'): void => {
	if (value === false) {
		return;
	}

	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new TypeError(`The \`${name}\` option must be a non-negative number or \`false\``);
	}

	if (value > maxSafeTimeout) {
		throw new RangeError(`The \`${name}\` option cannot be greater than ${maxSafeTimeout}`);
	}
};

const cloneRetryOptions = (retry: RetryOptions | number): RetryOptions | number => {
	if (retry === null || typeof retry !== 'object' || Array.isArray(retry)) {
		return retry as RetryOptions | number;
	}

	const clonedRetry = {...retry};

	// Clone nested arrays too so init hooks can mutate retry config without leaking state across requests.
	if (Array.isArray(clonedRetry.methods)) {
		clonedRetry.methods = [...clonedRetry.methods];
	}

	if (Array.isArray(clonedRetry.statusCodes)) {
		clonedRetry.statusCodes = [...clonedRetry.statusCodes];
	}

	if (Array.isArray(clonedRetry.afterStatusCodes)) {
		clonedRetry.afterStatusCodes = [...clonedRetry.afterStatusCodes];
	}

	return clonedRetry;
};

const objectToString = Object.prototype.toString;
const leadingC0ControlOrSpacePattern = /^[\0-\u0020]+/g;
const asciiTabOrNewLinePattern = /[\t\n\r]/g;
const schemePattern = /^[a-z][\d+.a-z-]*:/i;
const malformedHttpProtocolPattern = /^https?:(?!\/\/)/i;

const isRequestInstance = (value: unknown): value is Request =>
	value instanceof globalThis.Request || objectToString.call(value) === '[object Request]';

// Accepted custom responses are treated as full Responses throughout Ky.
// If a custom fetch returns one, it must behave like a Response for cloning,
// body consumption, `json()` decoration, and any enabled stream features.
const isResponseInstance = (value: unknown): value is Response =>
	value instanceof globalThis.Response || objectToString.call(value) === '[object Response]';

const isAbsoluteInput = (input: string): boolean =>
	schemePattern.test(input);

const normalizeInputForProtocolCheck = (input: string): string =>
	input.replaceAll(leadingC0ControlOrSpacePattern, '').replaceAll(asciiTabOrNewLinePattern, '');

const cloneSearchParametersForInitHook = (searchParameters: SearchParamsOption | undefined): SearchParamsOption | undefined => {
	if (Array.isArray(searchParameters)) {
		return searchParameters.map(parameter => [...parameter]) as SearchParamsOption;
	}

	return cloneShallow(searchParameters) as SearchParamsOption | undefined;
};

// Shallow-clone mutable option properties so init hook mutations don't leak across requests.
function cloneInitHookOptions(options: Options): InitOptions {
	let headers = mergeHeaderContainers({}, options.headers ?? {});
	let context = cloneDeep(options.context) ?? {};
	const clonedOptions: Options = {
		...options,
		// Deep-clone so init-hook mutations to nested values do not leak across requests, matching the nested `retry` cloning below. Non-plain values (functions, class instances) are kept by reference.
		json: cloneDeep(options.json),
		searchParams: cloneSearchParametersForInitHook(options.searchParams),
	};

	Object.defineProperties(clonedOptions, {
		headers: {
			enumerable: true,
			configurable: true,
			get() {
				return headers;
			},
			set(value: KyHeadersInit | undefined) {
				headers = mergeHeaderContainers({}, value ?? {});
			},
		},
		context: {
			enumerable: true,
			configurable: true,
			get() {
				return context;
			},
			set(value: Record<string, unknown> | undefined) {
				context = value ?? {};
			},
		},
	});

	if (options.retry !== undefined) {
		clonedOptions.retry = cloneRetryOptions(options.retry);
	}

	return clonedOptions as InitOptions;
}

const validateJsonWithSchema = async (jsonValue: unknown, schema: StandardSchemaV1): Promise<unknown> => {
	if (
		(
			typeof schema !== 'object'
			&& typeof schema !== 'function'
		)
		|| schema === null
	) {
		throw new TypeError(invalidSchemaMessage);
	}

	const standardSchema = schema['~standard'];

	if (
		typeof standardSchema !== 'object'
		|| standardSchema === null
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

		const function_ = async (): Promise<Response | void> => {
			validateTimeoutOption(ky.#options.totalTimeout, 'totalTimeout');
			validateTimeoutOption(ky.#options.timeout, 'timeout');

			// Delay the fetch so that body method shortcuts can set the Accept header
			await Promise.resolve();
			const beforeRequestResponse = await ky.#runBeforeRequestHooks();
			if (beforeRequestResponse !== undefined) {
				ky.#retryLimit = normalizeRetryOptions(ky.#options.retry).limit;
			}

			let response = beforeRequestResponse ?? await ky.#retry();
			let responseFromHook = beforeRequestResponse !== undefined
				|| ky.#consumeReturnedResponseFromBeforeRetryHook();

			for (;;) {
				// `undefined` means a hook stopped the flow without providing a response.
				// Non-native Responses still continue through Ky if they pass `isResponseInstance()`.
				if (response === undefined) {
					return response;
				}

				if (isResponseInstance(response)) {
					try {
						// eslint-disable-next-line no-await-in-loop
						response = await ky.#runAfterResponseHooks(response);
					} catch (error) {
						if (!(error instanceof ForceRetryError)) {
							throw error;
						}

						// eslint-disable-next-line no-await-in-loop
						const retriedResponse: Response | void = await ky.#retryFromError(error);
						if (retriedResponse === undefined) {
							return retriedResponse;
						}

						response = retriedResponse;
						responseFromHook = ky.#consumeReturnedResponseFromBeforeRetryHook();
						continue;
					}
				}

				const currentResponse: Response = response;

				// Opaque responses (`response.type === 'opaque'`) from `no-cors` requests always have `status: 0` and `ok: false`, but this is not a failure - the actual status is hidden by the browser.
				if (!currentResponse.ok && currentResponse.type !== 'opaque' && (
					typeof ky.#options.throwHttpErrors === 'function'
						? ky.#options.throwHttpErrors(currentResponse.status)
						: ky.#options.throwHttpErrors
				)) {
					// `request` must reflect the request that actually failed, but `options` stays as Ky's
					// normalized options snapshot. Replacement `Request` instances do not preserve the
					// original `BodyInit`, so trying to make `options` mirror arbitrary requests would be lossy.
					const httpError: HTTPError = new HTTPError(currentResponse, ky.#getResponseRequest(currentResponse), ky.#getNormalizedOptions());
					// eslint-disable-next-line no-await-in-loop
					httpError.data = await ky.#getResponseData(currentResponse);
					ky.#throwIfAbortedByUser();
					ky.#throwIfTotalTimeoutExhausted();

					if (responseFromHook) {
						throw httpError;
					}

					// eslint-disable-next-line no-await-in-loop
					const retriedResponse: Response | void = await ky.#retryFromError(httpError);
					if (retriedResponse === undefined) {
						return retriedResponse;
					}

					response = retriedResponse;
					responseFromHook = ky.#consumeReturnedResponseFromBeforeRetryHook();
					continue;
				}

				break;
			}

			if (!isResponseInstance(response)) {
				return response;
			}

			ky.#decorateResponse(response);

			// If `onDownloadProgress` is passed, it uses the stream API internally
			if (ky.#options.onDownloadProgress) {
				if (typeof ky.#options.onDownloadProgress !== 'function') {
					throw new TypeError('The `onDownloadProgress` option must be a function');
				}

				if (!supportsResponseStreams) {
					throw new Error('Streams are not supported in your environment. `ReadableStream` is missing.');
				}

				const progressResponse = streamResponse(response, ky.#options.onDownloadProgress);
				ky.#setResponseRequest(progressResponse, ky.#getResponseRequest(response));
				return ky.#decorateResponse(progressResponse);
			}

			return response;
		};

		const result = (async () => {
			let response: Response | undefined;
			try {
				response = (await function_()) ?? undefined;
				return response;
			} catch (error: unknown) {
				return await ky.#throwProcessedError(error);
			} finally {
				const originalRequest = ky.#originalRequest;

				// Ignore cancellation errors from already-locked or already-consumed streams.
				// A custom fetch or hook can return the request body as its response body; ownership then belongs to the caller.
				if (originalRequest?.body !== response?.body) {
					ky.#cancelBody(originalRequest?.body ?? undefined);
				}

				// Only cancel the current request body if it's distinct from the original (i.e. it was cloned for retries).
				if (ky.request !== originalRequest && ky.request.body !== response?.body) {
					ky.#cancelBody(ky.request.body ?? undefined);
				}
			}
		})() as ResponsePromise;

		for (const [type, mimeType] of Object.entries(responseTypes) as ObjectEntries<typeof responseTypes>) {
			// Only expose `.bytes()` when the environment implements it.
			if (
				type === 'bytes'
				&& typeof (globalThis.Response?.prototype as unknown as {bytes?: unknown})?.bytes !== 'function'
			) {
				continue;
			}

			result[type] = async (schema?: StandardSchemaV1) => {
				// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
				ky.request.headers.set('accept', ky.request.headers.get('accept') || mimeType);

				const response = await result;

				if (type !== 'json') {
					return ky.#raceBodyRead(async () => response[type](), response);
				}

				const text = await ky.#raceBodyRead(async () => response.text(), response) as string;
				const request = ky.#getResponseRequest(response);
				// This implementation is shared by every body method, so its return type has to satisfy all of them. The parsed value is whatever `parseJson` or `JSON.parse` produced, which is `any` at this boundary.
				let parsedResult: any;
				try {
					parsedResult = await ky.#raceWithTotalTimeout(async () => {
						const jsonValue = initHookOptions.parseJson
							? await initHookOptions.parseJson(text, {request, response})
							: (text === '' && schema !== undefined
								? undefined
								: JSON.parse(text));

						if (schema === undefined) {
							return jsonValue;
						}

						// eslint-disable-next-line no-return-await, @typescript-eslint/return-await -- Awaiting here preserves the caller's async stack when schema validation fails.
						return await validateJsonWithSchema(jsonValue, schema);
					}, ky.#userProvidedAbortSignal);
				} catch (error: unknown) {
					// A cancellation is part of the request lifecycle, so it reaches `beforeError` like every other abort. Other failures, such as invalid JSON, stay as they are.
					if (ky.#userProvidedAbortSignal?.aborted) {
						await ky.#throwProcessedError(ky.#userProvidedAbortSignal.reason);
					}

					throw error;
				}

				if (parsedResult === timedOutOperation) {
					await ky.#throwProcessedError(new TimeoutError(request));
				}

				return parsedResult;
			};
		}

		return result;
	}

	// eslint-disable-next-line unicorn/prevent-abbreviations
	static #normalizeSearchParams(searchParams: SearchParamsOption): SearchParamsOption {
		// Filter out undefined values from plain objects
		if (searchParams && typeof searchParams === 'object' && !Array.isArray(searchParams) && !(searchParams instanceof URLSearchParams)) {
			return Object.fromEntries(Object.entries(searchParams).filter(([, value]) => value !== undefined));
		}

		return searchParams;
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
	readonly #startTime: number | undefined;
	#returnedResponseFromBeforeRetryHook = false;
	readonly #responseRequests = new WeakMap<Response, Request>();
	readonly #decoratedResponses = new WeakSet<Response>();

	// eslint-disable-next-line complexity
	constructor(input: Input, options: Options = {}) {
		const {maxResponseSize = Number.POSITIVE_INFINITY} = options;
		if (Object.hasOwn(options, 'prefixUrl')) {
			throw new Error(prefixUrlRenamedErrorMessage);
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
			throwHttpErrors: options.throwHttpErrors ?? true,
			timeout: options.timeout ?? 10_000,
			totalTimeout: options.totalTimeout ?? false,
			maxResponseSize,
			fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
			// Deep-cloned so a hook mutating a nested plain object or array cannot write back to the instance defaults or the caller's object. Non-plain values such as class instances are kept by reference, matching how `json` and the shallow `context` merge treat them.
			context: cloneDeep(options.context) ?? {},
		};
		this.#retryLimit = this.#options.retry.limit;

		if (maxResponseSize !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(maxResponseSize) || maxResponseSize < 0)) {
			throw new TypeError('The `maxResponseSize` option must be a non-negative safe integer or Infinity');
		}

		if (typeof input !== 'string' && !(input instanceof URL || input instanceof globalThis.Request)) {
			throw new TypeError('`input` must be a string, URL, or Request');
		}

		this.#requestInput = input instanceof globalThis.Request ? input : undefined;

		if (typeof input === 'string') {
			if (this.#options.prefix) {
				const normalizedPrefix = this.#options.prefix.replace(/\/+$/, '');
				const normalizedInput = input.replace(/^\/+/, '');
				input = `${normalizedPrefix}/${normalizedInput}`;
			}

			if (this.#options.baseUrl) {
				const normalizedInput = normalizeInputForProtocolCheck(input);

				if (malformedHttpProtocolPattern.test(normalizedInput)) {
					throw new TypeError('`input` url protocol must be followed by `//` when using `baseUrl`');
				}

				if (!isAbsoluteInput(normalizedInput)) {
					input = new URL(input, (new Request(this.#options.baseUrl)).url);
				}
			}
		}

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

		if (hasSearchParameters(this.#options.searchParams)) {
			const url = new URL(this.request.url);
			const deleted = (this.#options.searchParams as any)?.[deletedParametersSymbol] as Set<string> | undefined;

			if (deleted) {
				// Remove keys from the input URL first so later searchParams entries can intentionally re-add them.
				for (const key of deleted) {
					url.searchParams.delete(key);
				}
			}

			if (typeof this.#options.searchParams === 'string') {
				const stringSearchParameters = this.#options.searchParams.replace(/^\?/, '');
				if (stringSearchParameters !== '') {
					url.search = url.search ? `${url.search}&${stringSearchParameters}` : `?${stringSearchParameters}`;
				}
			} else {
				const optionsSearchParameters = new URLSearchParams(Ky.#normalizeSearchParams(this.#options.searchParams) as unknown as SearchParamsInit);

				for (const [key, value] of optionsSearchParameters.entries()) {
					url.searchParams.append(key, value);
				}
			}

			if (
				this.#options.searchParams
				&& typeof this.#options.searchParams === 'object'
				&& !Array.isArray(this.#options.searchParams)
				&& !(this.#options.searchParams instanceof URLSearchParams)
			) {
				for (const [key, value] of Object.entries(this.#options.searchParams)) {
					if (value === undefined) {
						url.searchParams.delete(key);
					}
				}
			}

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

		if (this.#options.onUploadProgress && typeof this.#options.onUploadProgress !== 'function') {
			throw new TypeError('The `onUploadProgress` option must be a function');
		}

		// `totalTimeout` starts when the request pipeline is created, so it also includes
		// Ky's internal scheduling and user hook time before the first fetch attempt.
		this.#startTime = typeof this.#options.totalTimeout === 'number' ? this.#getCurrentTime() : undefined;
	}

	#calculateDelay(retry: InternalOptions['retry']): number {
		const retryDelay = retry.delay(this.#retryCount + 1);

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

		// Wrap non-Error throws to ensure consistent error handling
		const errorObject = error instanceof Error ? error : new NonError(error);

		// Handle forced retry from afterResponse hook - skip method check and shouldRetry
		if (errorObject instanceof ForceRetryError) {
			return errorObject.customDelay ?? this.#calculateDelay(retry);
		}

		// Check if method is retriable for non-forced retries
		if (!retry.methods.includes(normalizeRetryMethod(this.request.method))) {
			throw error;
		}

		let shouldRetryOverride = false;
		const {shouldRetry} = retry;
		if (shouldRetry !== undefined) {
			const result = await this.#raceWithTotalTimeout(async () => shouldRetry({error: errorObject, retryCount: this.#retryCount + 1}), this.#userProvidedAbortSignal);
			this.#throwIfAbortedByUser();
			if (result === timedOutOperation) {
				throw new TimeoutError(this.request);
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

			return this.#calculateDelay(retry);
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
					return this.#calculateDelay(retry);
				}

				// Don't apply jitter when server provides explicit retry timing
				return Math.min(retry.maxRetryAfter, after);
			}

			if (!shouldRetryOverride && error.response.status === 413) {
				throw error;
			}

			return this.#calculateDelay(retry);
		}

		// Only retry known retriable error types. Unknown errors (e.g., programming bugs) are not retried.
		if (!shouldRetryOverride && !isNetworkError(error)) {
			throw error;
		}

		return this.#calculateDelay(retry);
	}

	#decorateResponse(response: Response): Response {
		if (!this.#options.parseJson || this.#decoratedResponses.has(response)) {
			return response;
		}

		this.#decoratedResponses.add(response);
		const request = this.#getResponseRequest(response);

		response.json = async () => {
			const text = await response.text();
			return this.#options.parseJson!(text, {request, response});
		};

		// `clone()` returns a fresh `Response` that would otherwise fall back to the native `json()`.
		const nativeClone = response.clone.bind(response);
		response.clone = () => this.#decorateResponse(this.#setResponseRequest(nativeClone(), request));

		return response;
	}

	async #throwProcessedError(error: unknown): Promise<never> {
		// Non-Error throws (e.g., thrown strings) pass through unchanged
		if (!(error instanceof Error)) {
			throw error;
		}

		// Errors thrown by beforeRetry hooks must propagate unchanged.
		if (this.#beforeRetryHookErrors.has(error)) {
			throw error;
		}

		let processedError: Error = error;
		for (const hook of this.#options.hooks.beforeError) {
			// `request` is the current failing request. `options` intentionally remains the
			// stable normalized Ky options snapshot for the same reason as `HTTPError` above.
			// eslint-disable-next-line no-await-in-loop
			const hookResult: unknown = await hook({
				request: this.request,
				options: this.#getNormalizedOptions(),
				error: processedError,
				retryCount: this.#retryCount,
			});

			// Only overwrite if the hook returns a valid Error instance.
			if (hookResult instanceof Error) {
				processedError = hookResult;
			}
		}

		throw processedError;
	}

	async #getResponseData(response: Response): Promise<unknown> {
		// `request` is the request that actually produced this response, which is not `this.request` once a retry clone has been prepared.
		const request = this.#getResponseRequest(response);

		// Even with request timeouts disabled, bound error-body reads so retries and error propagation
		// cannot be stalled indefinitely by never-ending response streams.
		const readTimeout = this.#getErrorDataTimeout(request);
		const text = await this.#readResponseText(response, readTimeout.milliseconds);
		if (text === timedOutResponseData) {
			if (readTimeout.fromTotalTimeout) {
				throw new TimeoutError(request);
			}

			this.#throwIfTotalTimeoutExhausted(request);
			return undefined;
		}

		if (!text) {
			return undefined;
		}

		if (!this.#isJsonContentType(response.headers.get('content-type') ?? '')) {
			return text;
		}

		const parseTimeout = this.#getErrorDataTimeout(request);
		const data = await this.#parseJson(text, response, parseTimeout.milliseconds, request);
		if (data === timedOutResponseData) {
			if (parseTimeout.fromTotalTimeout) {
				throw new TimeoutError(request);
			}

			this.#throwIfTotalTimeoutExhausted(request);
			return undefined;
		}

		return data;
	}

	#getErrorDataTimeout(request: Request = this.request): ErrorDataTimeout {
		const errorDataTimeout = this.#options.timeout === false ? 10_000 : this.#options.timeout;
		const remainingTotal = this.#getRemainingTotalTimeout();
		if (remainingTotal === undefined) {
			return {
				milliseconds: errorDataTimeout,
				fromTotalTimeout: false,
			};
		}

		if (remainingTotal <= 0) {
			throw new TimeoutError(request);
		}

		return {
			milliseconds: Math.min(errorDataTimeout, remainingTotal),
			fromTotalTimeout: remainingTotal <= errorDataTimeout,
		};
	}

	#getEffectiveTimeout(): number | undefined {
		const remainingTotal = this.#getRemainingTotalTimeout();
		if (remainingTotal !== undefined) {
			if (remainingTotal <= 0) {
				throw new TimeoutError(this.request);
			}

			return this.#options.timeout === false
				? remainingTotal
				: Math.min(this.#options.timeout, remainingTotal);
		}

		return this.#options.timeout === false ? undefined : this.#options.timeout;
	}

	// Unlike error bodies (`#getResponseData`), a successful body read has no fallback value to return -
	// the caller's `.json()`/`.text()`/etc. promise must settle, so a timeout here always rejects.
	async #raceBodyRead(createBodyPromise: () => Promise<unknown>, response: Response): Promise<unknown> {
		let timeoutMs: number | undefined;
		try {
			timeoutMs = this.#getEffectiveTimeout();
		} catch (error: unknown) {
			await this.#throwProcessedError(error);
		}

		const bodyPromise = createBodyPromise();
		const timeoutPromise = timeoutMs === undefined
			? undefined
			: new Promise<typeof timedOutResponseData>(resolve => {
				const timeoutId = setTimeout(() => {
					resolve(timedOutResponseData);
				}, timeoutMs);
				void bodyPromise.finally(() => {
					clearTimeout(timeoutId);
				}).catch(() => undefined);
			});

		let result: unknown;
		try {
			result = timeoutPromise === undefined
				? await bodyPromise
				: await Promise.race([bodyPromise, timeoutPromise]);
		} catch (error: unknown) {
			if (this.#userProvidedAbortSignal?.aborted) {
				await this.#throwProcessedError(this.#userProvidedAbortSignal.reason);
			}

			if (this.#getRemainingTotalTimeout() !== 0) {
				// A throwing progress callback errors the response stream, which a browser may report as a raw `TypeError` that would otherwise be mistaken for a dropped connection. Surface the callback error instead.
				const progressCallbackError = getProgressCallbackError(response.body ?? undefined);
				if (progressCallbackError !== undefined) {
					await this.#throwProcessedError(progressCallbackError);
				}

				// A connection dropped while streaming the body surfaces as a raw runtime `TypeError`. Wrap it like fetch-phase network errors so it is recognizable and runs `beforeError` hooks.
				// This only happens on the awaited path, so a body that fails after the timeout already won does not run the hooks again.
				if (isRawNetworkError(error)) {
					await this.#throwProcessedError(new NetworkError(this.#getResponseRequest(response), {cause: error as Error}));
				}

				await this.#throwProcessedError(error);
			}

			result = timedOutResponseData;
		}

		if (result === timedOutResponseData || this.#getRemainingTotalTimeout() === 0) {
			// The stream is locked by the native body method's own reader by this point, so
			// `response.body.cancel()` would reject as "already locked". Aborting the request's
			// signal is what actually interrupts the underlying network read.
			this.#abortController?.abort();
			await this.#throwProcessedError(new TimeoutError(this.#getResponseRequest(response)));
		}

		return result;
	}

	async #raceWithTotalTimeout<T>(operation: () => Promise<T>, abortSignal?: AbortSignal): Promise<T | typeof timedOutOperation> {
		abortSignal?.throwIfAborted();

		const remainingTotal = this.#getRemainingTotalTimeout();
		if (remainingTotal !== undefined && remainingTotal <= 0) {
			this.#abortController?.abort();
			return timedOutOperation;
		}

		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		let abortListener: (() => void) | undefined;
		try {
			const abortPromise = new Promise<never>((_resolve, reject) => {
				if (!abortSignal) {
					return;
				}

				abortListener = () => {
					// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- AbortSignal reasons can be any value and must be preserved exactly.
					reject(abortSignal.reason);
				};

				abortSignal.addEventListener('abort', abortListener, {once: true});

				if (abortSignal.aborted) {
					abortListener();
				}
			});
			const operationPromise = operation();

			if (remainingTotal === undefined) {
				return await Promise.race([operationPromise, abortPromise]);
			}

			const timeoutPromise = new Promise<typeof timedOutOperation>(resolve => {
				timeoutId = setTimeout(() => {
					resolve(timedOutOperation);
				}, remainingTotal);
			});
			const result = await Promise.race([operationPromise, timeoutPromise, abortPromise]);
			const remainingAfterOperation = this.#getRemainingTotalTimeout();
			const didTimeOut = result === timedOutOperation || (remainingAfterOperation !== undefined && remainingAfterOperation <= 0);
			if (didTimeOut) {
				this.#abortController?.abort();

				if (result === timedOutOperation) {
					void operationPromise.then(value => {
						this.#cancelReturnedBody(value);
					}).catch(() => undefined);
				} else {
					this.#cancelReturnedBody(result);
				}

				return timedOutOperation;
			}

			return result;
		} catch (error: unknown) {
			abortSignal?.throwIfAborted();

			const remainingAfterOperation = this.#getRemainingTotalTimeout();
			if (remainingAfterOperation !== undefined && remainingAfterOperation <= 0) {
				this.#abortController?.abort();
				return timedOutOperation;
			}

			throw error;
		} finally {
			clearTimeout(timeoutId);
			if (abortListener) {
				abortSignal?.removeEventListener('abort', abortListener);
			}
		}
	}

	#isJsonContentType(contentType: string): boolean {
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
	}

	async #readResponseText(response: Response, timeoutMs: number): Promise<string | typeof timedOutResponseData | undefined> {
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
		const decoder = this.#isJsonContentType(contentType) ? new TextDecoder() : createTextDecoder(contentType);
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

		const timeoutPromise = new Promise<typeof timedOutResponseData>(resolve => {
			const timeoutId = setTimeout(() => {
				resolve(timedOutResponseData);
			}, timeoutMs);
			void readAll.finally(() => {
				clearTimeout(timeoutId);
			}).catch(() => undefined);
		});

		const result = await Promise.race([readAll, timeoutPromise]);
		if (result === timedOutResponseData) {
			void reader.cancel().catch(() => undefined);
		}

		return result;
	}

	async #parseJson(text: string, response: Response, timeoutMs: number, request: Request): Promise<unknown> {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				Promise.resolve().then(() => this.#options.parseJson
					? this.#options.parseJson(text, {request, response})
					: JSON.parse(text),
				),
				new Promise<typeof timedOutResponseData>(resolve => {
					timeoutId = setTimeout(() => {
						resolve(timedOutResponseData);
					}, timeoutMs);
				}),
			]);
		} catch {
			return undefined;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	#cancelBody(body: ReadableStream | undefined): void {
		if (!body) {
			return;
		}

		// Ignore cancellation failures from already-locked or already-consumed streams.
		void body.cancel().catch(() => undefined);
	}

	#cancelResponseBody(response: Response): void {
		// Ignore cancellation failures from already-locked or already-consumed streams.
		this.#cancelBody(response.body ?? undefined);
	}

	#cancelReturnedBody(value: unknown): void {
		if (isResponseInstance(value)) {
			this.#cancelResponseBody(value);
		} else if (isRequestInstance(value)) {
			this.#cancelBody(value.body ?? undefined);
		}
	}

	#createManagedSignal(): AbortSignal {
		return this.#userProvidedAbortSignal
			? AbortSignal.any([this.#userProvidedAbortSignal, this.#abortController!.signal])
			: this.#abortController!.signal;
	}

	#throwIfTotalTimeoutExhausted(request: Request = this.request): void {
		const remaining = this.#getRemainingTotalTimeout();
		if (remaining !== undefined && remaining <= 0) {
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
			}), this.#userProvidedAbortSignal);

			if (result === timedOutOperation) {
				throw new TimeoutError(this.request);
			}

			if (isRequestInstance(result)) {
				this.#assignRequest(this.#withManagedSignal(result));
			} else if (isResponseInstance(result)) {
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
					request: this.request,
					options: this.#getNormalizedOptions(),
					response: hookResponse,
					retryCount: this.#retryCount,
				}), this.#userProvidedAbortSignal);

				if (modifiedResponse === timedOutOperation) {
					throw new TimeoutError(this.request);
				}
			} catch (error) {
				// Cancel both responses to prevent memory leaks when hook throws
				if (hookResponse !== response) {
					this.#cancelResponseBody(hookResponse);
				}

				this.#cancelResponseBody(response);
				throw error;
			}

			if (modifiedResponse instanceof RetryMarker) {
				// Cancel both the cloned response passed to the hook and the current response to prevent resource leaks (especially important in Deno/Bun).
				// Do not await cancellation since hooks can clone the response, leaving extra tee branches that keep cancel promises pending per the Streams spec.
				if (hookResponse !== response) {
					this.#cancelResponseBody(hookResponse);
				}

				this.#cancelResponseBody(response);
				throw new ForceRetryError(modifiedResponse.options);
			}

			const nextResponse = isResponseInstance(modifiedResponse)
				? this.#setResponseRequest(modifiedResponse, responseRequest)
				: response;

			// Cancel any response bodies we won't use to prevent memory leaks.
			// Uses fire-and-forget since hooks may have cloned the response, creating tee branches that block cancellation.
			// If the hook wrapped an existing body into a new Response, both Response objects can still point at the same stream.
			if (hookResponse !== response && hookResponse !== nextResponse && hookResponse.body !== nextResponse.body) {
				this.#cancelResponseBody(hookResponse);
			}

			if (response !== nextResponse && response.body !== nextResponse.body) {
				this.#cancelResponseBody(response);
			}

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
		this.#returnedResponseFromBeforeRetryHook = false;

		const retryDelay = Math.min(await this.#calculateRetryDelay(error), maxSafeTimeout);
		const delayOptions = {signal: this.#userProvidedAbortSignal};

		const remainingTimeout = this.#getRemainingTotalTimeout();
		if (remainingTimeout !== undefined) {
			if (remainingTimeout <= 0) {
				throw new TimeoutError(this.request);
			}

			// If waiting would consume all remaining budget, time out without starting another request.
			if (retryDelay >= remainingTimeout) {
				await delay(remainingTimeout, delayOptions);
				throw new TimeoutError(this.request);
			}
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
		if (error instanceof ForceRetryError && error.customRequest) {
			// Replacement Requests are authoritative by design. Do not rewrite headers here,
			// even for cross-origin retries. Callers using `ky.retry({request})` explicitly
			// opted into the exact Request they constructed.
			this.#assignRequest(this.#withManagedSignal(error.customRequest));
		}

		for (const hook of this.#options.hooks.beforeRetry) {
			let hookResult: Awaited<ReturnType<typeof hook>> | typeof timedOutOperation;
			try {
				// eslint-disable-next-line no-await-in-loop
				hookResult = await this.#raceWithTotalTimeout(async () => hook({
					request: this.request,
					options: this.#getNormalizedOptions(),
					error: error instanceof Error ? error : new NonError(error),
					retryCount: this.#retryCount + 1,
				}), this.#userProvidedAbortSignal);
			} catch (hookError) {
				// Preserve the original request error path (`throw error`) so beforeError hooks can still run.
				if (hookError instanceof Error && hookError !== error) {
					this.#beforeRetryHookErrors.add(hookError);
				}

				throw hookError;
			}

			if (hookResult === timedOutOperation) {
				throw new TimeoutError(this.request);
			}

			if (isRequestInstance(hookResult)) {
				// Same contract as `ky.retry({request})`: a Request returned from `beforeRetry`
				// is used as-is rather than being sanitized or otherwise rewritten by Ky.
				this.#assignRequest(this.#withManagedSignal(hookResult));
				break;
			}

			if (isResponseInstance(hookResult)) {
				this.#returnedResponseFromBeforeRetryHook = true;
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

	#consumeReturnedResponseFromBeforeRetryHook(): boolean {
		const value = this.#returnedResponseFromBeforeRetryHook;
		this.#returnedResponseFromBeforeRetryHook = false;
		return value;
	}

	async #fetch(): Promise<Response> {
		// A previous attempt can return without consuming its upload. Release that unused branch before replacing the request reference.
		if (this.#originalRequest && this.#originalRequest.body !== this.request.body) {
			this.#cancelBody(this.#originalRequest.body ?? undefined);
		}

		const nonRequestOptions = findUnknownOptions(this.#options);
		this.#retryLimit = normalizeRetryOptions(this.#options.retry).limit;
		// Reattach the managed signal because Node.js can garbage-collect the abort controller used by Request.clone().
		const retryRequest = this.#retryLimit > 0 ? this.#withManagedSignal(this.request.clone()) : undefined;
		const request = this.#wrapRequestWithUploadProgress(this.request, this.#options.body ?? undefined);

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

			if (this.#getRemainingTotalTimeout() === 0) {
				this.#abortController?.abort();
				this.#cancelResponseBody(response);
				throw new TimeoutError(request);
			}

			return this.#setResponseRequest(response, request);
		} catch (error) {
			this.#throwIfAbortedByUser();
			if (this.#getRemainingTotalTimeout() === 0) {
				this.#abortController?.abort();
				throw new TimeoutError(request);
			}

			// The upload progress wrapper errors the request body stream when its callback throws, which the runtime reports as a network failure. Surface the callback error instead.
			const progressCallbackError = getProgressCallbackError(this.#originalRequest?.body ?? undefined);
			if (progressCallbackError !== undefined) {
				// eslint-disable-next-line @typescript-eslint/only-throw-error -- The callback can throw any value, and non-Error throws are propagated as-is elsewhere.
				throw progressCallbackError;
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

	#getRemainingTotalTimeout(): number | undefined {
		if (this.#startTime === undefined) {
			return undefined;
		}

		const elapsed = this.#getCurrentTime() - this.#startTime;
		return Math.max(0, (this.#options.totalTimeout as number) - elapsed);
	}

	#getCurrentTime(): number {
		return globalThis.performance?.now() ?? Date.now();
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
		if (this.#requestBodyCanBeCancelled && this.request.body !== request.body) {
			this.#cancelBody(this.request.body ?? undefined);
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

	#getResponseRequest(response: Response): Request {
		return this.#responseRequests.get(response) ?? this.request;
	}

	#setResponseRequest(response: Response, request: Request): Response {
		this.#responseRequests.set(response, request);
		return response;
	}

	#limitResponseSize(response: Response): Response {
		const request = this.#getResponseRequest(response);
		return this.#setResponseRequest(limitResponseSize(response, request, this.#options.maxResponseSize), request);
	}

	#wrapRequestWithUploadProgress(request: Request, originalBody?: BodyInit): Request {
		if (!this.#options.onUploadProgress || !supportsRequestStreams || !request.body) {
			return request;
		}

		return streamRequest(request, this.#options.onUploadProgress, originalBody ?? this.#options.body ?? undefined);
	}
}
