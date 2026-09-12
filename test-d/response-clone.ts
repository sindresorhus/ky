import {expectTypeOf} from 'expect-type';
import ky from 'ky';

const response = await ky<{name: string}>('https://example.com');
const clone = response.clone();

expectTypeOf(clone.json()).toEqualTypeOf<Promise<{name: string}>>();
expectTypeOf(clone.clone().json()).toEqualTypeOf<Promise<{name: string}>>();
expectTypeOf(clone.json<{id: number}>()).toEqualTypeOf<Promise<{id: number}>>();

const unknownResponse = await ky('https://example.com');
expectTypeOf(unknownResponse.clone().json()).toEqualTypeOf<Promise<unknown>>();
