import ky, {type Options} from 'ky';

const options: Options = {method: undefined};
void ky('https://example.com', options);
void ky.create({method: 'POST'}).extend({method: undefined});
void ky('https://example.com', {
	hooks: {
		init: [options => {
			options.method = undefined;
		}],
	},
});
