import test from 'ava';
import ky, {replaceOption} from '../source/index.js';

for (const form of ['object', 'URLSearchParams', 'tuples'] as const) {
	test(`replacement search parameters copy caller-owned ${form} values`, async t => {
		const searchParameters = form === 'object'
			? {tenant: 'original'}
			: (form === 'URLSearchParams' ? new URLSearchParams({tenant: 'original'}) : [['tenant', 'original']]);
		const parent = ky.create({
			searchParams: {removed: 'parent'},
			fetch: async request => new Response(request.url),
		});
		const child = parent.extend({searchParams: replaceOption(searchParameters)});

		if (searchParameters instanceof URLSearchParams) {
			searchParameters.set('tenant', 'changed');
		} else if (Array.isArray(searchParameters)) {
			searchParameters[0]![1] = 'changed';
		} else {
			searchParameters.tenant = 'changed';
		}

		t.is(await child('https://example.com').text(), 'https://example.com/?tenant=original');
		t.is(await parent('https://example.com').text(), 'https://example.com/?removed=parent');
	});
}

test('creating an instance copies tuple search parameters without changing their values', async t => {
	const searchParameters = [['tag', 'first'], ['tag', 'second'], ['page', 2], ['active', false]];
	const instance = ky.create({
		searchParams: searchParameters,
		fetch: async request => new Response(request.url),
	});
	searchParameters[0]![1] = 'changed';
	searchParameters.push(['extra', 'value']);

	t.is(await instance('https://example.com').text(), 'https://example.com/?tag=first&tag=second&page=2&active=false');
});

test('extend callback can edit frozen tuple defaults without changing the parent', async t => {
	const parent = ky.create({
		searchParams: Object.freeze([Object.freeze(['key', 'value'] as const)]),
		fetch: async request => new Response(request.url),
	});
	parent.extend(defaults => {
		if (Array.isArray(defaults.searchParams)) {
			defaults.searchParams[0]![0] = 'changed';
		}

		return {};
	});

	t.is(await parent('https://example.com').text(), 'https://example.com/?key=value');
});

test('extend callback cannot change parent tuple search parameters', async t => {
	const parent = ky.create({
		searchParams: [['tenant', 'parent']],
		fetch: async request => new Response(request.url),
	});
	const child = parent.extend(defaults => {
		if (Array.isArray(defaults.searchParams)) {
			defaults.searchParams[0]![1] = 'child';
		}

		return defaults;
	});

	t.is(await child('https://example.com').text(), 'https://example.com/?tenant=parent&tenant=child');
	t.is(await parent('https://example.com').text(), 'https://example.com/?tenant=parent');
});
