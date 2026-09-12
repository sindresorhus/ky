import {expectTypeOf} from 'expect-type';
import type {Options} from 'ky';

const withoutBaseUrl: Options = {baseUrl: undefined};
const withoutPrefix: Options = {prefix: undefined};

expectTypeOf(withoutBaseUrl.baseUrl).toMatchTypeOf<Options['baseUrl']>();
expectTypeOf(withoutPrefix.prefix).toMatchTypeOf<Options['prefix']>();
