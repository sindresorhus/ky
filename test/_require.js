import fetch, {Headers} from 'node-fetch';

global.self = {
	fetch,
	Headers
};
