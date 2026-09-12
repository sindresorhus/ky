import {expectTypeOf} from 'expect-type';
import type {ResponsePromise} from 'ky';

declare const response: ResponsePromise;
const bytes = await response.bytes();

expectTypeOf(bytes).toEqualTypeOf<Awaited<ReturnType<Response['bytes']>>>();
expectTypeOf(new Blob([bytes])).toEqualTypeOf<Blob>();
expectTypeOf(new Response(bytes)).toEqualTypeOf<Response>();
