import {HTTPError} from '../errors/HTTPError.js';
import {NonError} from '../errors/NonError.js';
import {ForceRetryError} from '../errors/ForceRetryError.js';
import type {
	Input,
	InternalOptions,
	NormalizedOptions,
	Options,
	SearchParamsInit,
	SearchParamsOption,
} from '../types/options.js';
import {type ResponsePromise} from '../types/ResponsePromise.js';
import {streamRequest, streamResponse} from '../utils/body.js';
import {mergeHeaders, mergeHooks} from '../utils/merge.js';
import {normalizeRequestMethod, normalizeRetryOptions} from '../utils/normalize.js';
import timeout, {type TimeoutOptions} from '../utils/timeout.js';
import delay from '../utils/delay.js';
import {type ObjectEntries} from '../utils/types.js';
import {findUnknownOptions, hasSearchParameters} from '../utils/options.js';
import {isHTTPError, isTimeoutError} from '../utils/type-guards.js';
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

export class Ky {
	static create(input: Input, options: Options): ResponsePromise {
		const ky = new Ky(input, options);

		const function_ = async (): Promise<Response> => {
			if (typeof ky.#options.timeout === 'number' && ky.#options.timeout > maxSafeTimeout) {
				throw new RangeError(`The \`timeout\` option cannot be greater than ${maxSafeTimeout}`);
			}

			// Delay the fetch so that body method shortcuts can set the Accept header
			await Promise.resolve();
			// Before using ky.request, _fetch clones it and saves the clone for future retries to use.
			// If retry is not needed, close the cloned request's ReadableStream for memory safety.
			let response = await ky.#fetch();

			for (const hook of ky.#options.hooks.afterResponse) {
				// Clone the response before passing to hook so we can cancel it if needed
				const clonedResponse = ky.#decorateResponse(response.clone());

				let modifiedResponse;
				try {
					// eslint-disable-next-line no-await-in-loop
					modifiedResponse = await hook(
						ky.request,
						ky.#getNormalizedOptions(),
						clonedResponse,
						{retryCount: ky.#retryCount},
					);
				} catch (error) {
					// Cancel both responses to prevent memory leaks when hook throws
					ky.#cancelResponseBody(clonedResponse);
					ky.#cancelResponseBody(response);
					throw error;
				}

				if (modifiedResponse instanceof RetryMarker) {
					// Cancel both the cloned response passed to the hook and the current response to prevent resource leaks (especially important in Deno/Bun).
					// Do not await cancellation since hooks can clone the response, leaving extra tee branches that keep cancel promises pending per the Streams spec.
					ky.#cancelResponseBody(clonedResponse);
					ky.#cancelResponseBody(response);
					throw new ForceRetryError(modifiedResponse.options);
				}

				// Determine which response to use going forward
				const nextResponse = modifiedResponse instanceof globalThis.Response ? modifiedResponse : response;

				// Cancel any response bodies we won't use to prevent memory leaks.
				// Uses fire-and-forget since hooks may have cloned the response, creating tee branches that block cancellation.
				if (clonedResponse !== nextResponse) {
					ky.#cancelResponseBody(clonedResponse);
				}

				if (response !== nextResponse) {
					ky.#cancelResponseBody(response);
				}

				response = nextResponse;
			}

			ky.#decorateResponse(response);

			if (!response.ok && (
				typeof ky.#options.throwHttpErrors === 'function'
					? ky.#options.throwHttpErrors(response.status)
					: ky.#options.throwHttpErrors
			)) {
				let error = new HTTPError(response, ky.request, ky.#getNormalizedOptions());
				error.data = await ky.#getResponseData(response);

				for (const hook of ky.#options.hooks.beforeError) {
					// eslint-disable-next-line no-await-in-loop
					error = await hook(error, {retryCount: ky.#retryCount});
				}

				throw error;
			}

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

		// Always wrap in #retry to catch forced retries from afterResponse hooks
		// Method retriability is checked in #calculateRetryDelay for non-forced retries
		const result = ky.#retry(function_)
			.finally(() => {
				const originalRequest = ky.#originalRequest;

				// Ignore cancellation errors from already-locked or already-consumed streams.
				ky.#cancelBody(originalRequest?.body ?? undefined);
				ky.#cancelBody(ky.request.body ?? undefined);
			}) as ResponsePromise;

		for (const [type, mimeType] of Object.entries(responseTypes) as ObjectEntries<typeof responseTypes>) {
			// Only expose `.bytes()` when the environment implements it.
			if (
				type === 'bytes'
				&& typeof (globalThis.Response?.prototype as unknown as {bytes?: unknown})?.bytes !== 'function'
			) {
				continue;
			}

			result[type] = async () => {
				// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
				ky.request.headers.set('accept', ky.request.headers.get('accept') || mimeType);

				const response = await result;

				if (type === 'json') {
					if (response.status === 204) {
						return '';
					}

					const text = await response.text();
					if (text === '') {
						return '';
					}

					if (options.parseJson) {
						return options.parseJson(text);
					}

					return JSON.parse(text);
				}

				return response[type]();
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
	#cachedNormalizedOptions: NormalizedOptions | undefined;

	// eslint-disable-next-line complexity
	constructor(input: Input, options: Options = {}) {
		this.#input = input;

		this.#options = {
			...options,
			headers: mergeHeaders((this.#input as Request).headers, options.headers),
			hooks: mergeHooks(
				{
					beforeRequest: [],
					beforeRetry: [],
					beforeError: [],
					afterResponse: [],
				},
				options.hooks,
			),
			method: normalizeRequestMethod(options.method ?? (this.#input as Request).method ?? 'GET'),
			// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
			prefixUrl: String(options.prefixUrl || ''),
			retry: normalizeRetryOptions(options.retry),
			throwHttpErrors: options.throwHttpErrors ?? true,
			timeout: options.timeout ?? 10_000,
			fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
			context: options.context ?? {},
		};

		if (typeof this.#input !== 'string' && !(this.#input instanceof URL || this.#input instanceof globalThis.Request)) {
			throw new TypeError('`input` must be a string, URL, or Request');
		}

		if (this.#options.prefixUrl && typeof this.#input === 'string') {
			if (this.#input.startsWith('/')) {
				throw new Error('`input` must not begin with a slash when using `prefixUrl`');
			}

			if (!this.#options.prefixUrl.endsWith('/')) {
				this.#options.prefixUrl += '/';
			}

			this.#input = this.#options.prefixUrl + this.#input;
		}

		if (supportsAbortController && supportsAbortSignal) {
			this.#userProvidedAbortSignal = this.#options.signal ?? (this.#input as Request).signal;
			this.#abortController = new globalThis.AbortController();
			this.#options.signal = this.#userProvidedAbortSignal ? AbortSignal.any([this.#userProvidedAbortSignal, this.#abortController.signal]) : this.#abortController.signal;
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
			// eslint-disable-next-line unicorn/prevent-abbreviations
			const textSearchParams = typeof this.#options.searchParams === 'string'
				? this.#options.searchParams.replace(/^\?/, '')
				: new URLSearchParams(Ky.#normalizeSearchParams(this.#options.searchParams) as unknown as SearchParamsInit).toString();
			// eslint-disable-next-line unicorn/prevent-abbreviations
			const searchParams = '?' + textSearchParams;
			const url = this.request.url.replace(/(?:\?.*?)?(?=#|$)/, searchParams);

			// Recreate request with the updated URL. We already have all options in this.#options, including duplex.
			this.request = new globalThis.Request(url, this.#options as RequestInit);
		}

		// If `onUploadProgress` is passed, it uses the stream API internally
		if (this.#options.onUploadProgress) {
			if (typeof this.#options.onUploadProgress !== 'function') {
				throw new TypeError('The `onUploadProgress` option must be a function');
			}

			if (!supportsRequestStreams) {
				throw new Error('Request streams are not supported in your environment. The `duplex` option for `Request` is not available.');
			}

			this.request = this.#wrapRequestWithUploadProgress(this.request, this.#options.body ?? undefined);
		}
	}

	#calculateDelay(): number {
		const retryDelay = this.#options.retry.delay(this.#retryCount);

		let jitteredDelay = retryDelay;
		if (this.#options.retry.jitter === true) {
			jitteredDelay = Math.random() * retryDelay;
		} else if (typeof this.#options.retry.jitter === 'function') {
			jitteredDelay = this.#options.retry.jitter(retryDelay);

			if (!Number.isFinite(jitteredDelay) || jitteredDelay < 0) {
				jitteredDelay = retryDelay;
			}
		}

		// Handle undefined backoffLimit by treating it as no limit (Infinity)
		const backoffLimit = this.#options.retry.backoffLimit ?? Number.POSITIVE_INFINITY;
		return Math.min(backoffLimit, jitteredDelay);
	}

	async #calculateRetryDelay(error: unknown) {
		this.#retryCount++;

		if (this.#retryCount > this.#options.retry.limit) {
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

		// User-provided shouldRetry function takes precedence over all other checks
		if (this.#options.retry.shouldRetry !== undefined) {
			const result = await this.#options.retry.shouldRetry({error: errorObject, retryCount: this.#retryCount});

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
		if (isTimeoutError(error) && !this.#options.retry.retryOnTimeout) {
			throw error;
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

				const max = this.#options.retry.maxRetryAfter ?? after;
				// Don't apply jitter when server provides explicit retry timing
				return Math.min(after, max);
			}

			if (error.response.status === 413) {
				throw error;
			}
		}

		return this.#calculateDelay();
	}

	#decorateResponse(response: Response): Response {
		if (this.#options.parseJson) {
			response.json = async () => this.#options.parseJson!(await response.text());
		}

		return response;
	}

	async #getResponseData(response: Response): Promise<unknown> {
		// Even with request timeouts disabled, bound error-body reads so retries and error propagation
		// cannot be stalled indefinitely by never-ending response streams.
		const errorDataTimeout = this.#options.timeout === false ? 10_000 : this.#options.timeout;
		const text = await this.#readResponseText(response, errorDataTimeout);

		if (!text) {
			return undefined;
		}

		if (!this.#isJsonContentType(response.headers.get('content-type') ?? '')) {
			return text;
		}

		return this.#parseJson(text, errorDataTimeout);
	}

	#isJsonContentType(contentType: string): boolean {
		// Match JSON subtypes like `json`, `problem+json`, and `vnd.api+json`.
		const mimeType = (contentType.split(';', 1)[0] ?? '').trim().toLowerCase();
		return /\/(?:.*[.+-])?json$/.test(mimeType);
	}

	async #readResponseText(response: Response, timeoutMs: number): Promise<string | undefined> {
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

		const timeoutPromise = new Promise<undefined>(resolve => {
			const timeoutId = setTimeout(() => {
				resolve(undefined);
			}, timeoutMs);
			void readAll.finally(() => {
				clearTimeout(timeoutId);
			});
		});

		const result = await Promise.race([readAll, timeoutPromise]);
		if (result === undefined) {
			void reader.cancel().catch(() => undefined);
		}

		return result;
	}

	async #parseJson(text: string, timeoutMs: number): Promise<unknown> {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				Promise.resolve().then(() => (this.#options.parseJson ?? JSON.parse)(text)),
				new Promise<undefined>(resolve => {
					timeoutId = setTimeout(() => {
						resolve(undefined);
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

	async #retry<T extends (...arguments_: any) => Promise<any>>(function_: T): Promise<ReturnType<T> | Response | void> {
		try {
			return await function_();
		} catch (error) {
			const ms = Math.min(await this.#calculateRetryDelay(error), maxSafeTimeout);
			if (this.#retryCount < 1) {
				throw error;
			}

			// Only use user-provided signal for delay, not our internal abortController
			await delay(ms, this.#userProvidedAbortSignal ? {signal: this.#userProvidedAbortSignal} : {});

			// Apply custom request from forced retry before beforeRetry hooks
			// Ensure the custom request has the correct managed signal for timeouts and user aborts
			if (error instanceof ForceRetryError && error.customRequest) {
				const managedRequest = this.#options.signal
					? new globalThis.Request(error.customRequest, {signal: this.#options.signal})
					: new globalThis.Request(error.customRequest);

				this.#assignRequest(managedRequest);
			}

			for (const hook of this.#options.hooks.beforeRetry) {
				// eslint-disable-next-line no-await-in-loop
				const hookResult = await hook({
					request: this.request,
					options: this.#getNormalizedOptions(),
					error: error as Error,
					retryCount: this.#retryCount,
				});

				if (hookResult instanceof globalThis.Request) {
					this.#assignRequest(hookResult);
					break;
				}

				// If a Response is returned, use it and skip the retry
				if (hookResult instanceof globalThis.Response) {
					return hookResult;
				}

				// If `stop` is returned from the hook, the retry process is stopped
				if (hookResult === stop) {
					return;
				}
			}

			return this.#retry(function_);
		}
	}

	async #fetch(): Promise<Response> {
		// Reset abortController if it was aborted (happens on timeout retry)
		if (this.#abortController?.signal.aborted) {
			this.#abortController = new globalThis.AbortController();
			this.#options.signal = this.#userProvidedAbortSignal ? AbortSignal.any([this.#userProvidedAbortSignal, this.#abortController.signal]) : this.#abortController.signal;
			// Recreate request with new signal
			this.request = new globalThis.Request(this.request, {signal: this.#options.signal});
		}

		for (const hook of this.#options.hooks.beforeRequest) {
			// eslint-disable-next-line no-await-in-loop
			const result = await hook(
				this.request,
				this.#getNormalizedOptions(),
				{retryCount: this.#retryCount},
			);

			if (result instanceof Response) {
				return result;
			}

			if (result instanceof globalThis.Request) {
				this.#assignRequest(result);
				break;
			}
		}

		const nonRequestOptions = findUnknownOptions(this.request, this.#options);

		// Cloning is done here to prepare in advance for retries
		this.#originalRequest = this.request;
		this.request = this.#originalRequest.clone();

		if (this.#options.timeout === false) {
			return this.#options.fetch(this.#originalRequest, nonRequestOptions);
		}

		return timeout(this.#originalRequest, nonRequestOptions, this.#abortController, this.#options as TimeoutOptions);
	}

	#getNormalizedOptions(): NormalizedOptions {
		if (!this.#cachedNormalizedOptions) {
			const {hooks, ...normalizedOptions} = this.#options;
			this.#cachedNormalizedOptions = Object.freeze(normalizedOptions) as NormalizedOptions;
		}

		return this.#cachedNormalizedOptions;
	}

	#assignRequest(request: Request): void {
		this.#cachedNormalizedOptions = undefined;
		this.request = this.#wrapRequestWithUploadProgress(request);
	}

	#wrapRequestWithUploadProgress(request: Request, originalBody?: BodyInit): Request {
		if (!this.#options.onUploadProgress || !request.body) {
			return request;
		}

		return streamRequest(request, this.#options.onUploadProgress, originalBody ?? this.#options.body ?? undefined);
	}
}
