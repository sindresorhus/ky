import {expectTypeOf} from 'expect-type';
import type {InitHook, RetryOptions} from 'ky';

const retryOptions: RetryOptions = {
	methods: ['get'] as const,
	statusCodes: [503] as const,
	afterStatusCodes: [503] as const,
};

const methods = ['get'] as const;
const statusCodes = [503] as const;
const afterStatusCodes = [503] as const;
const readonlyRetryOptions: RetryOptions = {methods, statusCodes, afterStatusCodes};

expectTypeOf(readonlyRetryOptions).toEqualTypeOf(retryOptions);

const initHook: InitHook = options => {
	if (typeof options.retry === 'object') {
		options.retry.methods?.push('post');
		options.retry.statusCodes?.push(500);
		options.retry.afterStatusCodes?.push(503);
		options.retry.methods = undefined;
		options.retry.statusCodes = undefined;
		options.retry.afterStatusCodes = undefined;
	}
};

expectTypeOf(initHook).toEqualTypeOf<InitHook>();

const defaultRetryDelay: RetryOptions = {delay: undefined};
expectTypeOf(defaultRetryDelay.delay).toMatchTypeOf<RetryOptions['delay']>();

const resetRetryOptions: RetryOptions[] = [
	{limit: undefined},
	{methods: undefined},
	{statusCodes: undefined},
	{afterStatusCodes: undefined},
	{maxRetryAfter: undefined},
	{backoffLimit: undefined},
	{retryOnTimeout: undefined},
];
expectTypeOf(resetRetryOptions).toEqualTypeOf<RetryOptions[]>();
