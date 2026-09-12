import {expectTypeOf} from 'expect-type';
import ky from 'ky';

void ky('https://example.com', {
	async fetch(request, options) {
		expectTypeOf(request).toEqualTypeOf<Request>();
		expectTypeOf(request.method).toEqualTypeOf<string>();
		expectTypeOf(request.url).toEqualTypeOf<string>();
		return globalThis.fetch(request, options);
	},
});

void ky('https://example.com', {fetch: globalThis.fetch});
