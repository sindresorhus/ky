import ky, {type Options} from 'ky';

const resetOptions: Options[] = [
	{body: undefined},
	{cache: undefined},
	{credentials: undefined},
	{integrity: undefined},
	{keepalive: undefined},
	{mode: undefined},
	{redirect: undefined},
	{referrer: undefined},
	{referrerPolicy: undefined},
];

for (const options of resetOptions) {
	void ky('https://example.com', options);
	void ky.create().extend(options);
}

void ky('https://example.com', {
	hooks: {
		init: [options => {
			options.body = undefined;
			options.credentials = undefined;
			options.cache = undefined;
		}],
	},
});

// @ts-expect-error - Allowing resets must not accept invalid credentials.
void ky('https://example.com', {credentials: 'invalid'});

// @ts-expect-error - Allowing resets must not accept invalid bodies.
void ky('https://example.com', {body: 42});
