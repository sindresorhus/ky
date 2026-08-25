import {expectTypeOf} from 'expect-type';
import type {
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
