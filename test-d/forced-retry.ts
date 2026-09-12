import ky from 'ky';

ky.retry({delay: undefined});
ky.retry({code: undefined});
ky.retry({cause: undefined});
ky.retry({request: undefined});
