import test from 'ava';
import ky from '../source/index.js';
import {getBodySize} from '../source/utils/body.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

test('returns 0 for undefined', t => {
	t.is(getBodySize(undefined), 0);
});

test('returns 0 for null', t => {
	t.is(getBodySize(null), 0);
});

test('returns correct size for ASCII string', t => {
	t.is(getBodySize('hello'), 5);
});

test('returns correct size for multi-byte string', t => {
	// Emoji is 4 bytes in UTF-8
	t.is(getBodySize('😀'), 4);
	t.is(getBodySize('hello 😀 world'), 16);
});

test('returns correct size for empty string', t => {
	t.is(getBodySize(''), 0);
});

test('returns correct size for ArrayBuffer', t => {
	const buffer = new ArrayBuffer(16);
	t.is(getBodySize(buffer), 16);
});

test('returns correct size for Uint8Array', t => {
	const array = new Uint8Array([1, 2, 3, 4, 5]);
	t.is(getBodySize(array), 5);
});

test('returns correct size for Uint16Array', t => {
	const array = new Uint16Array([1, 2, 3]);
	t.is(getBodySize(array), 6); // 3 elements × 2 bytes
});

test('returns correct size for Float64Array', t => {
	const array = new Float64Array([1, 2]);
	t.is(getBodySize(array), 16); // 2 elements × 8 bytes
});

test('returns correct size for DataView', t => {
	const buffer = new ArrayBuffer(10);
	const view = new DataView(buffer);
	t.is(getBodySize(view), 10);
});

test('returns correct size for TypedArray subarray', t => {
	const full = new Uint8Array([1, 2, 3, 4, 5]);
	const sub = full.subarray(1, 3);
	// Should return the view's byteLength (2), not the underlying buffer's (5)
	t.is(getBodySize(sub), 2);
});

test('returns 0 for zero-length ArrayBuffer', t => {
	t.is(getBodySize(new ArrayBuffer(0)), 0);
});

test('returns correct size for Blob', t => {
	const blob = new Blob(['hello world']);
	t.is(getBodySize(blob), 11);
});

test('returns correct size for Blob with multi-byte content', t => {
	const blob = new Blob(['😀']);
	t.is(getBodySize(blob), 4);
});

test('returns correct size for File', t => {
	const file = new File(['hello world'], 'test.txt', {type: 'text/plain'});
	t.is(getBodySize(file), 11);
});

test('returns correct size for URLSearchParams', t => {
	const parameters = new URLSearchParams({foo: 'bar', baz: 'qux'});
	t.is(getBodySize(parameters), 15); // 'foo=bar&baz=qux'
});

test('returns correct size for empty URLSearchParams', t => {
	const parameters = new URLSearchParams();
	t.is(getBodySize(parameters), 0);
});

test('returns 0 for ReadableStream', t => {
	const stream = new ReadableStream();
	t.is(getBodySize(stream), 0);
});

test('returns 0 for empty FormData', t => {
	const formData = new FormData();
	t.is(getBodySize(formData), 0);
});

test('FormData returns a positive size', t => {
	const formData = new FormData();
	formData.append('key', 'value');
	const size = getBodySize(formData);
	t.true(size > 0, `Expected positive size, got ${size}`);
});

test('FormData size increases with more fields', t => {
	const formData1 = new FormData();
	formData1.append('a', '1');
	const size1 = getBodySize(formData1);

	const formData2 = new FormData();
	formData2.append('a', '1');
	formData2.append('b', '2');
	const size2 = getBodySize(formData2);

	t.true(size2 > size1, `Two fields (${size2}) should be larger than one field (${size1})`);
});

test('FormData with Blob value accounts for blob size', t => {
	const formData = new FormData();
	formData.append('file', new Blob(['hello world']));

	const size = getBodySize(formData);
	// Size should be at least the blob content size (11 bytes)
	t.true(size >= 11, `Expected size >= 11, got ${size}`);
});

// Pinned exactly, because the per-part byte counts are the whole point of the estimate erring high and a one-byte change to any of them is invisible to a range assertion.
test('the FormData estimate counts the framing, the filename and the content type', t => {
	const one = new FormData();
	one.append('a', 'one');
	// Closing boundary 46, plus one part of 44 + 40 + 4 + 3 + 2.
	t.is(getBodySize(one), 139);

	const two = new FormData();
	two.append('a', 'one');
	two.append('b', 'two');
	// 139, plus one more part of 44 + 40 + 4 + 3 + 2 for the value `two`.
	t.is(getBodySize(two), 232);

	const withFile = new FormData();
	withFile.append('f', new File(['abc'], 'n.txt', {type: 'text/plain'}));
	// A `File` adds `; filename="n.txt"` (18) and a `\r\nContent-Type: text/plain` (26).
	t.is(getBodySize(withFile), 46 + 44 + 40 + 18 + 26 + 4 + 3 + 2);

	const withBlob = new Blob(['abc']);
	const withUnnamedBlob = new FormData();
	withUnnamedBlob.append('f', withBlob);
	// The runtime names the blob `blob`, so `; filename="blob"` (17), and the default `\r\nContent-Type: application/octet-stream` (40).
	t.is(getBodySize(withUnnamedBlob), 46 + 44 + 40 + 17 + 40 + 4 + 3 + 2);

	// Bun keeps an appended `Blob` as a `Blob` with an `undefined` name and sends `; filename=""` (13) for it.
	const bunLikeFormData = new FormData();
	bunLikeFormData.append('f', 'placeholder');
	bunLikeFormData[Symbol.iterator] = function * () {
		yield ['f', Object.defineProperty(new Blob(['abc']), 'name', {value: undefined})];
	} as FormData[typeof Symbol.iterator];
	t.is(getBodySize(bunLikeFormData), 46 + 44 + 40 + 13 + 40 + 4 + 3 + 2);

	t.is(getBodySize(new FormData()), 0);
});

// The FormData estimate omitted the per-part framing, the `filename` parameter, the `Content-Type` line and the closing boundary, so it was always below the real size. An estimate below the real size makes the reported upload percentage reach its ceiling part way through, so the estimate now errs high instead.
test('the FormData estimate is never below the serialized size', async t => {
	const server = await createHttpTestServer(t, {bodyParser: false});
	server.post('/', async (request, response) => {
		response.end(String(request.headers['content-length']));
	});

	const cases: Array<[string, () => FormData]> = [
		['a few short fields', () => {
			const form = new FormData();
			form.append('a', 'one');
			form.append('b', 'two');
			form.append('c', 'three');
			return form;
		}],
		['many short fields', () => {
			const form = new FormData();
			for (let index = 0; index < 100; index++) {
				form.append('field', 'value');
			}

			return form;
		}],
		['a file with a name and a type', () => {
			const form = new FormData();
			form.append('file', new File(['x'.repeat(1024)], 'a.txt', {type: 'text/plain'}));
			return form;
		}],
		['a blob with no name', () => {
			const form = new FormData();
			form.append('file', new Blob(['x'.repeat(1024)]));
			return form;
		}],
		['a large file', () => {
			const form = new FormData();
			form.append('file', new File(['x'.repeat(1024 * 1024)], 'big.bin'));
			return form;
		}],
		['a field with a long name', () => {
			const form = new FormData();
			form.append('a'.repeat(60), 'value');
			return form;
		}],
		// Line breaks in a value are sent as CRLF, so a bare `\n` or `\r` takes two bytes.
		['bare line breaks in a value', () => {
			const form = new FormData();
			form.append('text', 'line\n'.repeat(1000));
			form.append('other', 'a\rb'.repeat(500));
			return form;
		}],
		// Quotes and line breaks in a name or filename are escaped to three bytes each.
		['quotes and line breaks in names', () => {
			const form = new FormData();
			form.append('a"b\nc'.repeat(50), 'value');
			form.append('file', new File(['x'], 'q"u\no"te'.repeat(50)));
			return form;
		}],
	];

	for (const [label, build] of cases) {
		const form = build();
		// eslint-disable-next-line no-await-in-loop
		const serialized = Number(await ky.post(server.url, {body: form, retry: 0}).text());
		const estimate = getBodySize(form);

		t.true(estimate >= serialized, `${label}: estimate ${estimate} must not be below the real ${serialized}`);
		// A wildly high estimate would be just as wrong, so keep it in the same ballpark.
		t.true(estimate < serialized * 1.2, `${label}: estimate ${estimate} is too far above the real ${serialized}`);
	}
});
