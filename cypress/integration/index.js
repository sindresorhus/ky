import ky from '../..';

describe('ky', () => {
	it('throws when `input` starts with a slash and the `prefixUrl` option is set', () => {
		expect(() => {
			ky('/foo', {prefixUrl: '/'});
		}).to.throw(Error, /must not begin with a slash/);
	});
});
