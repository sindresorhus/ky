import test from 'ava';
import {getBodySize} from '../source/utils/body.js';

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
