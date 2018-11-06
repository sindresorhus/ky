import ky from '../..';

describe('ky', () => {
	it('throws when `input` starts with a slash and the `prefixUrl` option is set', () => {
		expect(() => {
			ky('/foo', {prefixUrl: '/'});
		}).to.throw(Error, /must not begin with a slash/);
	});

	it('resolves relative URLs for `input` and `prefixUrl`', async () => {
		expect(await ky('/cypress/fixtures/fixture.json').json()).to.deep.equal({foo: true});
		expect(await ky('fixtures/fixture.json', {prefixUrl: '/cypress/'}).json()).to.deep.equal({foo: true});
	});
});
