import test from 'ava';
import ky from '../source/index.js';

test('undefined request options clear inherited defaults without changing the parent', async t => {
	const url = 'https://example.com';
	const parent = ky.create({
		method: 'POST',
		body: 'parent',
		credentials: 'include',
		cache: 'no-store',
		async fetch(request) {
			return Response.json({body: await request.text(), credentials: request.credentials, cache: request.cache});
		},
	});
	const resetOptions = {body: undefined, credentials: undefined, cache: undefined};
	const extended = parent.extend(resetOptions);
	const expected = {body: '', credentials: 'same-origin', cache: 'default'};

	t.deepEqual(await parent(url, resetOptions).json(), expected);
	t.deepEqual(await extended(url).json(), expected);
	t.deepEqual(await extended(new Request(url, {
		method: 'POST',
		body: 'input',
		credentials: 'omit',
		cache: 'reload',
	})).json(), {body: 'input', credentials: 'omit', cache: 'reload'});
	t.deepEqual(await parent(url).json(), {body: 'parent', credentials: 'include', cache: 'no-store'});
});

test('init hooks can clear inherited request options', async t => {
	const response = await ky.post('https://example.com', {
		body: 'parent',
		credentials: 'include',
		cache: 'no-store',
		hooks: {
			init: [options => {
				options.body = undefined;
				options.credentials = undefined;
				options.cache = undefined;
			}],
		},
		async fetch(request) {
			return Response.json({body: await request.text(), credentials: request.credentials, cache: request.cache});
		},
	}).json();

	t.deepEqual(response, {body: '', credentials: 'same-origin', cache: 'default'});
});
