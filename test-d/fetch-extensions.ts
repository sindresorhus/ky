import type {Options} from 'ky';

// Ky forwards options it does not recognize to `fetch()`, so a fetch-only extension must be accepted even though
// the ambient `RequestInit` type does not declare it.
const withDispatcher: Options = {dispatcher: {fake: true}};
const withNext: Options = {next: {revalidate: 0}};

void withDispatcher;
void withNext;
