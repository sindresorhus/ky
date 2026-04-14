import {HTTPError} from '../errors/HTTPError.js';
import {NetworkError} from '../errors/NetworkError.js';
import {NonError} from '../errors/NonError.js';
import {ForceRetryError} from '../errors/ForceRetryError.js';
import {SchemaValidationError} from '../errors/SchemaValidationError.js';
import {TimeoutError} from '../errors/TimeoutError.js';
import type {
	Input,
	InternalOptions,
	NormalizedOptions,
	Options,
	SearchParamsInit,
	SearchParamsOption,
} from '../types/options.js';
import {type ResponsePromise} from '../types/ResponsePromise.js';
import type {StandardSchemaV1} from '../types/standard-schema.js';
import {streamRequest, streamResponse} from '../utils/body.js';
import {
	cloneShallow,
	mergeHeaders,
	mergeHooks,
	deletedParametersSymbol,
} from '../utils/merge.js';
import type {RetryOptions} from '../types/retry.js';
import {normalizeRequestMethod, normalizeRetryOptions} from '../utils/normalize.js';
import timeout from '../utils/timeout.js';
import delay from '../utils/delay.js';
import {type ObjectEntries} from '../utils/types.js';
import {findUnknownOptions, hasSearchParameters} from '../utils/options.js';
import isRawNetworkError from '../utils/is-network-error.js';
import {isHTTPError, isNetworkError, isTimeoutError} from '../utils/type-guards.js';
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

const cloneRetryOptions = (retry: RetryOptions | number): RetryOptions | number => {
	if (typeof retry !== 'object') {
		return retry;
	}

	// Clone nested arrays too so init hooks can mutate retry config without leaking state across requests.
	return {
		...retry,
		...(retry.methods && {methods: [...retry.methods]}),
		...(retry.statusCodes && {statusCodes: [...retry.statusCodes]}),
		...(retry.afterStatusCodes && {afterStatusCodes: [...retry.afterStatusCodes]}),
	};
};

const objectToString = Object.prototype.toString;

const isRequestInstance = (value: unknown): value is Request =>
	value instanceof globalThis.Request || objectToString.call(value) === '[object Request]';

// Accepted custom responses are treated as full Responses throughout Ky.
// If a custom fetch returns one, it must behave like a Response for cloning,
// body consumption, `json()` decoration, and any enabled stream features.
const isResponseInstance = (value: unknown): value is Response =>
	value instanceof globalThis.Response || objectToString.call(value) === '[object Response]';

// Shallow-clone mutable option properties so init hook mutations don't leak across requests.
function cloneInitHookOptions(options: Options): Options {
	const clonedOptions: Options = {
		...options,
		json: cloneShallow(options.json),
		context: cloneShallow(options.context)!,
		headers: cloneShallow(options.headers)!,
		searchParams: cloneShallow(options.searchParams) as SearchParamsOption | undefined,
	};

	if (options.retry !== undefined) {
		clonedOptions.retry = cloneRetryOptions(options.retry);
	}

	return clonedOptions;
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
			hook(initHookOptions);
		}

		const ky = new Ky(input, initHookOptions);

		const function_ = async (): Promise<Response | void> => {
			if (typeof ky.#options.timeout === 'number' && ky.#options.timeout > maxSafeTimeout) {
				throw new RangeError(`The \`timeout\` option cannot be greater than ${maxSafeTimeout}`);
			}

			if (typeof ky.#options.totalTimeout === 'number' && ky.#options.totalTimeout > maxSafeTimeout) {
				throw new RangeError(`The \`totalTimeout\` option cannot be greater than ${maxSafeTimeout}`);
			}

			// Delay the fetch so that body method shortcuts can set the Accept header
			await Promise.resolve();
			const beforeRequestResponse = await ky.#runBeforeRequestHooks();
			let response = beforeRequestResponse ?? await ky.#retry(async () => ky.#fetch());
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
						const retriedResponse: Response | void = await ky.#retryFromError(error, async () => ky.#fetch());
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
					const errorToThrow: Error = httpError;
					// eslint-disable-next-line no-await-in-loop
					httpError.data = await ky.#getResponseData(currentResponse);

					if (responseFromHook) {
						throw errorToThrow;
					}

					// eslint-disable-next-line no-await-in-loop
					const retriedResponse: Response | void = await ky.#retryFromError(httpError, async () => ky.#fetch());
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

				const progressResponse = response.clone();
				ky.#cancelResponseBody(response);
				return streamResponse(progressResponse, ky.#options.onDownloadProgress);
			}

			return response;
		};

		const result = (async () => {
			try {
				return await function_();
			} catch (error: unknown) {
				// Non-Error throws (e.g., thrown strings) pass through unchanged
				if (!(error instanceof Error)) {
					throw error;
				}

				// Errors thrown by beforeRetry hooks must propagate unchanged.
				if (ky.#beforeRetryHookErrors.has(error)) {
					throw error;
				}

				let processedError: Error = error;
				for (const hook of ky.#options.hooks.beforeError) {
					// `request` is the current failing request. `options` intentionally remains the
					// stable normalized Ky options snapshot for the same reason as `HTTPError` above.
					// eslint-disable-next-line no-await-in-loop
					const hookResult: unknown = await hook({
						request: ky.request,
						options: ky.#getNormalizedOptions(),
						error: processedError,
						retryCount: ky.#retryCount,
					});

					// Only overwrite if the hook returns a valid Error instance.
					if (hookResult instanceof Error) {
						processedError = hookResult;
					}
				}

				throw processedError;
			} finally {
				const originalRequest = ky.#originalRequest;

				// Ignore cancellation errors from already-locked or already-consumed streams.
				ky.#cancelBody(originalRequest?.body ?? undefined);
				// Only cancel the current request body if it's distinct from the original (i.e. it was cloned for retries).
				if (ky.request !== originalRequest) {
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
					return response[type]();
				}

				const text = await response.text();
				if (text === '') {
					if (schema !== undefined) {
						return validateJsonWithSchema(undefined, schema);
					}

					return JSON.parse(text);
				}

				const jsonValue = initHookOptions.parseJson
					? await initHookOptions.parseJson(text, {request: ky.#getResponseRequest(response), response})
					: JSON.parse(text);

				return schema === undefined ? jsonValue : validateJsonWithSchema(jsonValue, schema);
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
	// eslint-disable-next-line @typescript-eslint/prefer-readonly -- False positive: #input is reassigned on line 202
	#input: Input;
	readonly #options: InternalOptions;
	#originalRequest?: Request;
	readonly #userProvidedAbortSignal?: AbortSignal;
	readonly #beforeRetryHookErrors = new WeakSet<Error>();
	#cachedNormalizedOptions: NormalizedOptions | undefined;
	readonly #startTime: number | undefined;
	#returnedResponseFromBeforeRetryHook = false;
	readonly #responseRequests = new WeakMap<Response, Request>();

	// eslint-disable-next-line complexity
	constructor(input: Input, options: Options = {}) {
		this.#input = input;
		if (Object.hasOwn(options, 'prefixUrl')) {
			throw new Error(prefixUrlRenamedErrorMessage);
		}

		this.#options = {
			...options,
			headers: mergeHeaders((this.#input as Request).headers, options.headers),
			hooks: mergeHooks({}, options.hooks),
			method: normalizeRequestMethod(options.method ?? (this.#input as Request).method ?? 'GET'),
			// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
			prefix: String(options.prefix || ''),
			retry: normalizeRetryOptions(options.retry),
			throwHttpErrors: options.throwHttpErrors ?? true,
			timeout: options.timeout ?? 10_000,
			totalTimeout: options.totalTimeout ?? false,
			fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
			context: options.context ?? {},
		};

		if (typeof this.#input !== 'string' && !(this.#input instanceof URL || this.#input instanceof globalThis.Request)) {
			throw new TypeError('`input` must be a string, URL, or Request');
		}

		if (typeof this.#input === 'string') {
			if (this.#options.prefix) {
				const normalizedPrefix = this.#options.prefix.replace(/\/+$/, '');
				const normalizedInput = this.#input.replace(/^\/+/, '');
				this.#input = `${normalizedPrefix}/${normalizedInput}`;
			}

			if (this.#options.baseUrl) {
				let absoluteInput: URL | undefined;
				try {
					absoluteInput = new URL(this.#input);
				} catch {}

				if (!absoluteInput) {
					this.#input = new URL(this.#input, (new Request(this.#options.baseUrl)).url);
				}
			}
		}

		if (supportsAbortController && supportsAbortSignal) {
			this.#userProvidedAbortSignal = this.#options.signal ?? (this.#input as Request).signal;
			this.#abortController = new globalThis.AbortController();
			this.#options.signal = this.#createManagedSignal();
		}

		if (supportsRequestStreams) {
			// @ts-expect-error - Types are outdated.
			this.#options.duplex = 'half';
		}

		if (this.#options.json !== undefined) {
			this.#options.body = this.#options.stringifyJson?.(this.#options.json) ?? JSON.stringify(this.#options.json);
			this.#options.headers.set('content-type', this.#options.headers.get('content-type') ?? 'application/json');
		}

		// To provide correct form boundary, Content-Type header should be deleted when creating Request from another Request with FormData/URLSearchParams body
		// Only delete if user didn't explicitly provide a custom content-type
		const userProvidedContentType = options.headers && new globalThis.Headers(options.headers as HeadersInit).has('content-type');
		if (
			this.#input instanceof globalThis.Request
			&& ((supportsFormData && this.#options.body instanceof globalThis.FormData) || this.#options.body instanceof URLSearchParams)
			&& !userProvidedContentType
		) {
			this.#options.headers.delete('content-type');
		}

		this.request = new globalThis.Request(this.#input, this.#options);

		if (hasSearchParameters(this.#options.searchParams)) {
			const url = new URL(this.request.url);

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

			const deleted = (this.#options.searchParams as any)?.[deletedParametersSymbol] as Set<string> | undefined;
			if (deleted) {
				for (const key of deleted) {
					url.searchParams.delete(key);
				}
			}

			// Recreate request with the updated URL. We already have all options in this.#options, including duplex.
			this.request = new globalThis.Request(url, this.#options as RequestInit);
		}

		if (this.#options.onUploadProgress && typeof this.#options.onUploadProgress !== 'function') {
			throw new TypeError('The `onUploadProgress` option must be a function');
		}

		// `totalTimeout` starts when the request pipeline is created, so it also includes
		// Ky's internal scheduling and user hook time before the first fetch attempt.
		this.#startTime = typeof this.#options.totalTimeout === 'number' ? this.#getCurrentTime() : undefined;
	}

	#calculateDelay(): number {
		const retryDelay = this.#options.retry.delay(this.#retryCount + 1);

		let jitteredDelay = retryDelay;
		if (this.#options.retry.jitter === true) {
			jitteredDelay = Math.random() * retryDelay;
		} else if (typeof this.#options.retry.jitter === 'function') {
			jitteredDelay = this.#options.retry.jitter(retryDelay);

			if (!Number.isFinite(jitteredDelay) || jitteredDelay < 0) {
				jitteredDelay = retryDelay;
			}
		}

		return Math.min(this.#options.retry.backoffLimit, jitteredDelay);
	}

	async #calculateRetryDelay(error: unknown) {
		if (this.#retryCount >= this.#options.retry.limit) {
			throw error;
		}

		// Wrap non-Error throws to ensure consistent error handling
		const errorObject = error instanceof Error ? error : new NonError(error);

		// Handle forced retry from afterResponse hook - skip method check and shouldRetry
		if (errorObject instanceof ForceRetryError) {
			return errorObject.customDelay ?? this.#calculateDelay();
		}

		// Check if method is retriable for non-forced retries
		if (!this.#options.retry.methods.includes(this.request.method.toLowerCase())) {
			throw error;
		}

		// User-provided shouldRetry function takes precedence over default checks (retryOnTimeout, status codes, etc.)
		if (this.#options.retry.shouldRetry !== undefined) {
			const result = await this.#options.retry.shouldRetry({error: errorObject, retryCount: this.#retryCount + 1});

			// Strict boolean checking - only exact true/false are handled specially
			if (result === false) {
				throw error;
			}

			if (result === true) {
				// Force retry - skip all other validation and return delay
				return this.#calculateDelay();
			}

			// If undefined or any other value, fall through to default behavior
		}

		// Default timeout behavior
		if (isTimeoutError(error)) {
			if (!this.#options.retry.retryOnTimeout) {
				throw error;
			}

			return this.#calculateDelay();
		}

		if (isHTTPError(error)) {
			if (!this.#options.retry.statusCodes.includes(error.response.status)) {
				throw error;
			}

			const retryAfter = error.response.headers.get('Retry-After')
				?? error.response.headers.get('RateLimit-Reset')
				?? error.response.headers.get('X-RateLimit-Retry-After') // Symfony-based services
				?? error.response.headers.get('X-RateLimit-Reset') // GitHub
				?? error.response.headers.get('X-Rate-Limit-Reset'); // Twitter
			if (retryAfter && this.#options.retry.afterStatusCodes.includes(error.response.status)) {
				let after = Number(retryAfter) * 1000;
				if (Number.isNaN(after)) {
					after = Date.parse(retryAfter) - Date.now();
				} else if (after >= Date.parse('2024-01-01')) {
					// A large number is treated as a timestamp (fixed threshold protects against clock skew)
					after -= Date.now();
				}

				if (!Number.isFinite(after)) {
					return Math.min(this.#options.retry.maxRetryAfter, this.#calculateDelay());
				}

				after = Math.max(0, after);

				// Don't apply jitter when server provides explicit retry timing
				return Math.min(this.#options.retry.maxRetryAfter, after);
			}

			if (error.response.status === 413) {
				throw error;
			}

			return this.#calculateDelay();
		}

		// Only retry known retriable error types. Unknown errors (e.g., programming bugs) are not retried.
		if (!isNetworkError(error)) {
			throw error;
		}

		return this.#calculateDelay();
	}

	#decorateResponse(response: Response): Response {
		const request = this.#getResponseRequest(response);

		if (this.#options.parseJson) {
			response.json = async () => {
				const text = await response.text();
				if (text === '') {
					return JSON.parse(text);
				}

				return this.#options.parseJson!(text, {request, response});
			};
		}

		return response;
	}

	async #getResponseData(response: Response): Promise<unknown> {
		// Even with request timeouts disabled, bound error-body reads so retries and error propagation
		// cannot be stalled indefinitely by never-ending response streams.
		const text = await this.#readResponseText(response, this.#getErrorDataTimeout());
		if (text === timedOutResponseData) {
			this.#throwIfTotalTimeoutExhausted();
			return undefined;
		}

		if (!text) {
			return undefined;
		}

		if (!this.#isJsonContentType(response.headers.get('content-type') ?? '')) {
			return text;
		}

		const data = await this.#parseJson(text, response, this.#getErrorDataTimeout(), this.#getResponseRequest(response));
		if (data === timedOutResponseData) {
			this.#throwIfTotalTimeoutExhausted();
			return undefined;
		}

		return data;
	}

	#getErrorDataTimeout(): number {
		const errorDataTimeout = this.#options.timeout === false ? 10_000 : this.#options.timeout;
		const remainingTotal = this.#getRemainingTotalTimeout();
		if (remainingTotal === undefined) {
			return errorDataTimeout;
		}

		if (remainingTotal <= 0) {
			throw new TimeoutError(this.request);
		}

		return Math.min(errorDataTimeout, remainingTotal);
	}

	#isJsonContentType(contentType: string): boolean {
		// Match JSON subtypes like `json`, `problem+json`, and `vnd.api+json`.
		const mimeType = (contentType.split(';', 1)[0] ?? '').trim().toLowerCase();
		return /\/(?:.*[.+-])?json$/.test(mimeType);
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

		const decoder = createTextDecoder(response.headers.get('content-type') ?? '');
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
			} catch {
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
			});
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

	#createManagedSignal(): AbortSignal {
		return this.#userProvidedAbortSignal
			? AbortSignal.any([this.#userProvidedAbortSignal, this.#abortController!.signal])
			: this.#abortController!.signal;
	}

	#throwIfTotalTimeoutExhausted(): void {
		const remaining = this.#getRemainingTotalTimeout();
		if (remaining !== undefined && remaining <= 0) {
			throw new TimeoutError(this.request);
		}
	}

	async #runBeforeRequestHooks(): Promise<Response | undefined> {
		for (const hook of this.#options.hooks.beforeRequest) {
			// eslint-disable-next-line no-await-in-loop
			const result = await hook({
				request: this.request,
				options: this.#getNormalizedOptions(),
				retryCount: 0,
			});

			if (isRequestInstance(result)) {
				this.#assignRequest(result);
			} else if (isResponseInstance(result)) {
				return result;
			}
		}

		return undefined;
	}

	async #runAfterResponseHooks(response: Response): Promise<Response> {
		const responseRequest = this.#getResponseRequest(response);

		for (const hook of this.#options.hooks.afterResponse) {
			const hookResponse = this.#setResponseRequest(response.clone(), responseRequest);
			this.#decorateResponse(hookResponse);

			let modifiedResponse;
			try {
				// eslint-disable-next-line no-await-in-loop
				modifiedResponse = await hook({
					request: this.request,
					options: this.#getNormalizedOptions(),
					response: hookResponse,
					retryCount: this.#retryCount,
				});
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

			response = nextResponse;
		}

		return response;
	}

	async #retry<T extends (...arguments_: any) => Promise<any>>(function_: T): Promise<ReturnType<T> | Response | void> {
		try {
			return await function_();
		} catch (error) {
			return this.#retryFromError(error, function_);
		}
	}

	async #retryFromError<T extends (...arguments_: any) => Promise<any>>(error: unknown, function_: T): Promise<ReturnType<T> | Response | void> {
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

		// Apply custom request from forced retry before beforeRetry hooks
		// Ensure the custom request has the correct managed signal for timeouts and user aborts
		if (error instanceof ForceRetryError && error.customRequest) {
			this.#assignRequest(new globalThis.Request(error.customRequest, this.#options.signal ? {signal: this.#options.signal} : undefined));
		}

		for (const hook of this.#options.hooks.beforeRetry) {
			let hookResult: Awaited<ReturnType<typeof hook>>;
			try {
				// eslint-disable-next-line no-await-in-loop
				hookResult = await hook({
					request: this.request,
					options: this.#getNormalizedOptions(),
					error: error as Error,
					retryCount: this.#retryCount + 1,
				});
			} catch (hookError) {
				// Preserve the original request error path (`throw error`) so beforeError hooks can still run.
				if (hookError instanceof Error && hookError !== error) {
					this.#beforeRetryHookErrors.add(hookError);
				}

				throw hookError;
			}

			if (isRequestInstance(hookResult)) {
				this.#assignRequest(hookResult);
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
		return this.#retry(function_);
	}

	#consumeReturnedResponseFromBeforeRetryHook(): boolean {
		const value = this.#returnedResponseFromBeforeRetryHook;
		this.#returnedResponseFromBeforeRetryHook = false;
		return value;
	}

	async #fetch(): Promise<Response> {
		// Reset abortController if it was aborted (happens on timeout retry)
		if (this.#abortController?.signal.aborted) {
			this.#abortController = new globalThis.AbortController();
			this.#options.signal = this.#createManagedSignal();
			// Recreate request with new signal
			this.request = new globalThis.Request(this.request, {signal: this.#options.signal});
		}

		const nonRequestOptions = findUnknownOptions(this.#options);
		const retryRequest = this.#options.retry.limit > 0 ? this.request.clone() : undefined;
		const request = this.#wrapRequestWithUploadProgress(this.request, this.#options.body ?? undefined);

		// Cloning is done here to prepare in advance for retries.
		// Skip cloning when retries are disabled - cloning a streaming body calls ReadableStream#tee()
		// which buffers the entire stream in memory, causing excessive memory usage for large uploads.
		this.#originalRequest = request;
		if (retryRequest) {
			this.request = retryRequest;
		}

		try {
			const remainingTotal = this.#getRemainingTotalTimeout();
			if (remainingTotal !== undefined && remainingTotal <= 0) {
				throw new TimeoutError(this.request);
			}

			const effectiveTimeout: number | undefined = this.#options.timeout === false
				? remainingTotal
				: (remainingTotal === undefined
					? this.#options.timeout
					: Math.min(this.#options.timeout, remainingTotal));

			const response = effectiveTimeout === undefined
				? await this.#options.fetch(request, nonRequestOptions)
				: await timeout(request, nonRequestOptions, this.#abortController, {
					timeout: effectiveTimeout,
					fetch: this.#options.fetch,
				});

			return this.#setResponseRequest(response, request);
		} catch (error) {
			if (isRawNetworkError(error)) {
				throw new NetworkError(this.request, {cause: error as Error});
			}

			throw error;
		}
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
				throwHttpErrors,
				fetch,
				...normalizedOptions
			} = this.#options;

			this.#cachedNormalizedOptions = Object.freeze(normalizedOptions) as NormalizedOptions;
		}

		return this.#cachedNormalizedOptions;
	}

	#assignRequest(request: Request): void {
		this.#cachedNormalizedOptions = undefined;
		this.request = request;
	}

	#getResponseRequest(response: Response): Request {
		return this.#responseRequests.get(response) ?? this.request;
	}

	#setResponseRequest(response: Response, request: Request): Response {
		this.#responseRequests.set(response, request);
		return response;
	}

	#wrapRequestWithUploadProgress(request: Request, originalBody?: BodyInit): Request {
		if (!this.#options.onUploadProgress || !request.body || !supportsRequestStreams) {
			return request;
		}

		return streamRequest(request, this.#options.onUploadProgress, originalBody ?? this.#options.body ?? undefined);
	}
}
