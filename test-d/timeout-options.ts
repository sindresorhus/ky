import {expectTypeOf} from 'expect-type';
import type {Options} from 'ky';

const defaultTimeout: Options = {timeout: undefined};
const withoutTotalTimeout: Options = {totalTimeout: undefined};

expectTypeOf(defaultTimeout.timeout).toMatchTypeOf<Options['timeout']>();
expectTypeOf(withoutTotalTimeout.totalTimeout).toMatchTypeOf<Options['totalTimeout']>();
