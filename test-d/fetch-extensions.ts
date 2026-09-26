import {expectTypeOf} from 'expect-type';
import type {Options} from 'ky';

type NextFetchRequestConfig = {
	revalidate?: number | false;
	tags?: string[];
};

// Frameworks and runtimes declare their fetch-only extensions on the global `RequestInit`, the way Next.js declares `next` and `@types/node` declares `dispatcher`. Ky must pick up that type rather than redeclare the option, which conflicts with the ambient declaration.
declare global {
	// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- Global augmentation requires an interface.
	interface RequestInit {
		next?: NextFetchRequestConfig;
	}
}

const withNext: Options = {next: {revalidate: 0}};

expectTypeOf<Options['next']>().toEqualTypeOf<NextFetchRequestConfig | undefined>();

void withNext;
