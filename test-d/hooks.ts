import {expectTypeOf} from 'expect-type';
import type {
	BeforeErrorHook, BeforeRetryHook, BeforeRetryUpdate, Hooks, InitHook,
} from 'ky';

const hookList = [() => undefined] as const;
const beforeErrorHook: BeforeErrorHook = ({error}) => error;
const beforeErrorHooks = [beforeErrorHook] as const;
const hooks: Hooks = {
	init: hookList,
	beforeRequest: hookList,
	beforeRetry: hookList,
	beforeError: beforeErrorHooks,
	afterResponse: hookList,
};

expectTypeOf(hooks).toEqualTypeOf<Hooks>();

const initHook: InitHook = options => {
	options.hooks?.beforeRequest?.push(() => undefined);
	if (options.hooks) {
		options.hooks.beforeRequest = undefined;
	}
};

expectTypeOf(initHook).toEqualTypeOf<InitHook>();

const retryOptionsHook: BeforeRetryHook = () => ({options: {onUploadProgress: undefined, timeout: false}});
const asyncRetryOptionsHook: BeforeRetryHook = async () => ({options: {throwHttpErrors: false}});
// `undefined` restores the default for every option, so it must be accepted with `exactOptionalPropertyTypes`.
const restoreDefaultsHook: BeforeRetryHook = () => ({
	options: {
		onUploadProgress: undefined,
		onDownloadProgress: undefined,
		timeout: undefined,
		fetch: undefined,
		throwHttpErrors: undefined,
	},
});
expectTypeOf(retryOptionsHook).toEqualTypeOf<BeforeRetryHook>();
expectTypeOf(asyncRetryOptionsHook).toEqualTypeOf<BeforeRetryHook>();
expectTypeOf(restoreDefaultsHook).toEqualTypeOf<BeforeRetryHook>();

const withoutUploadProgress = (): BeforeRetryUpdate => ({options: {onUploadProgress: undefined}});
const separateFunctionHook: BeforeRetryHook = withoutUploadProgress;
expectTypeOf(separateFunctionHook).toEqualTypeOf<BeforeRetryHook>();
// @ts-expect-error The `body` option cannot be returned from a hook.
const invalidUpdate: BeforeRetryUpdate = {options: {body: 'payload'}};
expectTypeOf(invalidUpdate).toEqualTypeOf<BeforeRetryUpdate>();

// @ts-expect-error Request properties must be changed through the request.
const bodyOptionsHook: BeforeRetryHook = () => ({options: {body: 'payload'}});
// @ts-expect-error The `retry` option cannot be returned from a hook.
const retryLimitOptionsHook: BeforeRetryHook = () => ({options: {retry: 2}});
// @ts-expect-error The `timeout` option must be a number or `false`.
const invalidTimeoutOptionsHook: BeforeRetryHook = () => ({options: {timeout: 'soon'}});
// @ts-expect-error `null` is not accepted.
const nullFetchOptionsHook: BeforeRetryHook = () => ({options: {fetch: null}});
expectTypeOf(bodyOptionsHook).toEqualTypeOf<BeforeRetryHook>();
expectTypeOf(retryLimitOptionsHook).toEqualTypeOf<BeforeRetryHook>();
expectTypeOf(invalidTimeoutOptionsHook).toEqualTypeOf<BeforeRetryHook>();
expectTypeOf(nullFetchOptionsHook).toEqualTypeOf<BeforeRetryHook>();
