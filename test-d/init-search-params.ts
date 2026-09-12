import {expectTypeOf} from 'expect-type';
import type {InitHook} from 'ky';

const initHook: InitHook = options => {
	if (Array.isArray(options.searchParams)) {
		options.searchParams.push(['page', 2], ['active', true]);
		// @ts-expect-error - Search parameter values must remain scalar.
		options.searchParams[0] = ['invalid', {}];
	}
};

expectTypeOf(initHook).toEqualTypeOf<InitHook>();
