import test, {type ExecutionContext} from 'ava';
import {getBodySize} from '../source/utils/body.js';
import {createLargeBlob} from './helpers/create-large-file.js';

async function testBodySize(t: ExecutionContext, body: unknown) {
	const actualSize = getBodySize(body);
	const expectedBytes = await new Response(body).arrayBuffer();
	const expectedSize = expectedBytes.byteLength;
	const expectedText = new TextDecoder().decode(expectedBytes);

	t.is(actualSize, expectedSize, `\`${expectedText}\` predicted body size (${actualSize}) not actual size ${expectedSize}`);
}

const encoder = new TextEncoder();
const encoded = encoder.encode('unicorn');
const encoded2 = encoder.encode('abcd');
const encoded4 = encoder.encode('abcdefgh');
const encoded8 = encoder.encode('abcdefghabcdefgh');

// Test all supported body types (https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#setting_a_body)
test('string', async t => {
	await testBodySize(t, 'unicorn');
});

test('multi-byte string', async t => {
	await testBodySize(t, '😍');
});

test('ArrayBuffer', async t => {
	await testBodySize(t, encoded.buffer);
});

test('TypedArray', async t => {
	await testBodySize(t, encoded);
	await testBodySize(t, new Uint8Array(encoded));
	await testBodySize(t, new Uint8ClampedArray(encoded));
	await testBodySize(t, new Int8Array(encoded));

	await testBodySize(t, new Uint16Array(encoded2.buffer));
	await testBodySize(t, new Int16Array(encoded2.buffer));

	await testBodySize(t, new Uint32Array(encoded4.buffer));
	await testBodySize(t, new Int32Array(encoded4.buffer));
	await testBodySize(t, new Float32Array(encoded4.buffer));

	await testBodySize(t, new Float64Array(encoded8.buffer));

	await testBodySize(t, new BigInt64Array(encoded8.buffer));
	await testBodySize(t, new BigUint64Array(encoded8.buffer));
});

test('DataView', async t => {
	await testBodySize(t, new DataView(encoded.buffer));
});

test('Blob', async t => {
	// Test with different combinations of parameters, file type, content type, filename, etc.
	await testBodySize(t, new Blob(['unicorn'], {type: 'text/plain'}));
	await testBodySize(t, new Blob(['unicorn'], {type: 'customtype'}));
	await testBodySize(t, new Blob(['unicorn']));
});

test('File', async t => {
	await testBodySize(t, new File(['unicorn'], 'unicorn.txt', {type: 'text/plain'}));
	await testBodySize(t, new File(['unicorn'], 'unicorn.txt'));
	await testBodySize(t, new File(['😍'], '😍.txt'));
});

test('URLSearchParams', async t => {
	await testBodySize(t, new URLSearchParams({foo: 'bar', baz: 'qux 😍'}));
});

test('FormData - string', async t => {
	const formData = new FormData();
	formData.append('field', 'value');
	await testBodySize(t, formData);
});

test('FormData - multiple strings', async t => {
	const formData = new FormData();
	formData.append('field1', 'value1');
	formData.append('field2', 'value2');
	await testBodySize(t, formData);
});

test('FormData - blob', async t => {
	const formData = new FormData();
	formData.append('file', new Blob(['test content']));
	await testBodySize(t, formData);
});

test('FormData - blob with filename', async t => {
	const formData = new FormData();
	formData.append('file', new Blob(['test content']), 'test.txt');
	await testBodySize(t, formData);
});

test('FormData - multiple fields', async t => {
	const formData = new FormData();
	formData.append('file', new Blob(['test content']), 'test.txt');
	formData.append('field1', 'value1');
	formData.append('field2', 'value2');
	formData.append('emoji', '😍');
	await testBodySize(t, formData);
});

test('FormData - blob from buffer', async t => {
	const formData = new FormData();
	formData.append('file', new Blob([encoded]), 'test.txt');
	await testBodySize(t, formData);
});

test('FormData - blob with content type', async t => {
	const formData = new FormData();
	formData.append('file', new Blob(['test content'], {type: 'text/plain'}), 'test.txt');
	await testBodySize(t, formData);
});

test('FormData - multiple blobs', async t => {
	const formData = new FormData();
	formData.append('file1', new Blob(['file content 1'], {type: 'text/plain'}), 'file1.txt');
	formData.append('file2', new Blob(['file content 2'], {type: 'text/plain'}), 'file2.txt');
	await testBodySize(t, formData);
});

test('FormData - file', async t => {
	const formData = new FormData();
	formData.append('file', new File(['test content'], 'test.txt', {type: 'text/plain'}));
	await testBodySize(t, formData);
});

test('FormData - large blob', async t => {
	const largeBlob = createLargeBlob(10); // 10MB Blob
	const formData = new FormData();
	formData.append('file', largeBlob, 'large-file.bin');
	await testBodySize(t, formData);
});

test.failing('ReadableStream', async t => {
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode('unicorn'));
			controller.close();
		},
	});

	await testBodySize(t, stream);
});

test('null and undefined (no body)', async t => {
	await testBodySize(t, null);
	await testBodySize(t, undefined);
});
