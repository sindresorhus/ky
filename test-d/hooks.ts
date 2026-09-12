import {expectTypeOf} from 'expect-type';
import type {BeforeErrorHook, Hooks, InitHook} from 'ky';

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
