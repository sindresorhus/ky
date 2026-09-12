import {expectTypeOf} from 'expect-type';
import type {Options} from 'ky';

const defaultFetch: Options = {fetch: undefined};

expectTypeOf(defaultFetch.fetch).toMatchTypeOf<Options['fetch']>();
