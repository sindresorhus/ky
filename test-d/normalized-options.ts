import {expectTypeOf} from 'expect-type';
import type {
	BeforeRequestHook,
	BeforeRequestState,
	HTTPError,
	NormalizedOptions,
	Options,
	RetryOptions,
} from 'ky';

declare module 'ky' {
	interface Options { // eslint-disable-line @typescript-eslint/consistent-type-definitions -- Declaration merging requires an interface.
		customOption?: string;
	}

	interface NormalizedOptions { // eslint-disable-line @typescript-eslint/consistent-type-definitions -- Declaration merging requires an interface.
		customOption?: string;
	}
}

type ExpectedNormalizedRetryOptions = Required<Omit<RetryOptions, 'shouldRetry'>> & Pick<RetryOptions, 'shouldRetry'>;
type ExpectedProgressCallbacks = {
	readonly onDownloadProgress?: NonNullable<Options['onDownloadProgress']>;
	readonly onUploadProgress?: NonNullable<Options['onUploadProgress']>;
};

declare const options: NormalizedOptions;
declare const beforeRequestState: BeforeRequestState;
declare const httpError: HTTPError;
const contextKey = 'test';

expectTypeOf(options.headers).toEqualTypeOf<Headers>();
expectTypeOf(options.retry).branded.toEqualTypeOf<ExpectedNormalizedRetryOptions>();
expectTypeOf<Readonly<Pick<NormalizedOptions, keyof ExpectedProgressCallbacks>>>().branded.toEqualTypeOf<ExpectedProgressCallbacks>();

options.headers.set('x-test', 'value');
options.context[contextKey] = true;
options.retry.limit = 0;
options.retry.statusCodes.push(500);

// @ts-expect-error - The normalized options object is frozen.
options.method = 'POST';

// @ts-expect-error - Inherited request options are frozen too.
options.cache = 'no-store';

// @ts-expect-error - The normalized options object is frozen.
options.context = {};

// @ts-expect-error - The normalized options object is frozen.
options.retry = {...options.retry};

// @ts-expect-error - Module-augmented options passed to hooks are frozen too.
beforeRequestState.options.customOption = 'value';

// @ts-expect-error - Module-augmented options attached to errors are frozen too.
httpError.options.customOption = 'value';

// Documented ways to remove inherited values must type-check with `exactOptionalPropertyTypes`.
const withoutHooks: Options = {hooks: {beforeRequest: undefined, afterResponse: []}};
const withoutSignal: Options = {signal: undefined};
expectTypeOf(withoutHooks.hooks?.beforeRequest).toEqualTypeOf<BeforeRequestHook[] | undefined>();
// eslint-disable-next-line @typescript-eslint/no-restricted-types
expectTypeOf(withoutSignal.signal).toEqualTypeOf<AbortSignal | null | undefined>();

// `shouldRetry` may return nothing to fall back to the default retry logic, like every hook type.
const shouldRetryOptions: Options = {
	retry: {
		shouldRetry() {
			// Nothing to decide here.
		},
	},
};
const asyncShouldRetryOptions: Options = {
	retry: {
		async shouldRetry() {
			await Promise.resolve();
		},
	},
};
expectTypeOf(shouldRetryOptions.retry).toMatchTypeOf<RetryOptions | number | undefined>();
expectTypeOf(asyncShouldRetryOptions.retry).toMatchTypeOf<RetryOptions | number | undefined>();
