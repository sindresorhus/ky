import {expectTypeOf} from 'expect-type';
import ky, {type KyRequest} from 'ky';

const request: KyRequest<{name: string}> = new Request('https://example.com');
const clone = request.clone();

expectTypeOf(clone.json()).toEqualTypeOf<Promise<{name: string}>>();
expectTypeOf(clone.clone().json()).toEqualTypeOf<Promise<{name: string}>>();
expectTypeOf(clone.json<{id: number}>()).toEqualTypeOf<Promise<{id: number}>>();

void ky.post('https://example.com', {
	json: {name: 'Ada'},
	hooks: {
		beforeRequest: [({request}) => {
			expectTypeOf(request.clone().json()).toEqualTypeOf<Promise<unknown>>();
			expectTypeOf(request.clone().json<{name: string}>()).toEqualTypeOf<Promise<{name: string}>>();
		}],
	},
});
