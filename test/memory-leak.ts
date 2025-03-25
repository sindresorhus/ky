import test from 'ava';
import _LeakDetector from 'jest-leak-detector';
import ky, {type KyInstance} from '../source/index.js';
import {createHttpTestServer} from './helpers/create-http-test-server.js';

const LeakDetector = _LeakDetector.default as typeof _LeakDetector;

test('shared abort signal must not cause memory leak of input', async t => {
	const server = await createHttpTestServer();
	server.get('/', (_request, response) => {
		response.end('ok');
	});

	async function isKyLeaking(api: KyInstance) {
		let url: URL | undefined = new URL(
			`${server.url.toString()}?id=${Math.random()}`,
		);
		const detector = new LeakDetector(url);

		await api.get(url);

		url = undefined;

		return detector.isLeaking();
	}

	const abortController = new AbortController();

	try {
		t.false(await isKyLeaking(ky.extend({})));
		t.false(await isKyLeaking(ky.extend({signal: abortController.signal})));
	} finally {
		abortController.abort();
		await server.close();
	}
});
