import {expectTypeOf} from 'expect-type';
import ky, {type StandardSchemaV1} from 'ky';

expectTypeOf(ky('https://example.com').json(undefined)).toEqualTypeOf<Promise<unknown>>();
expectTypeOf(ky<{name: string}>('https://example.com').json(undefined)).toEqualTypeOf<Promise<{name: string}>>();
expectTypeOf(ky('https://example.com').json<{name: string}>(undefined)).toEqualTypeOf<Promise<{name: string}>>();

const schema: StandardSchemaV1<unknown, number> = {
	'~standard': {
		version: 1,
		vendor: 'test',
		validate: () => ({value: 1}),
	},
};

expectTypeOf(ky('https://example.com').json(schema)).toEqualTypeOf<Promise<number>>();

// @ts-expect-error - Non-schema objects must not match either overload.
void ky('https://example.com').json({});
