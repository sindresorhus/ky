import {expectTypeOf} from 'expect-type';
import type {Options} from 'ky';

const headers = [['Accept', 'application/json'], ['X-Request-ID', '123']] as const;
const options: Options = {headers};

expectTypeOf(options.headers).toMatchTypeOf<Options['headers']>();
