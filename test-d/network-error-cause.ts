import {expectTypeOf} from 'expect-type';
import {NetworkError} from 'ky';

const request = new Request('https://example.com');
const error = new NetworkError(request, {cause: undefined});
expectTypeOf(error).toEqualTypeOf<NetworkError>();

const createNetworkError = (cause?: Error) => new NetworkError(request, {cause});
expectTypeOf(createNetworkError()).toEqualTypeOf<NetworkError>();

// @ts-expect-error - Supplied causes must still be Error instances.
const invalidCause = new NetworkError(request, {cause: 'Disconnected'});
expectTypeOf(invalidCause).toEqualTypeOf<NetworkError>();
