import {expectTypeOf} from 'expect-type';
import type {Options, SearchParamsOption} from 'ky';

const searchParameters = [['tag', 'one'], ['tag', 'two'], ['page', 2], ['active', true]] as const;
const options: Options = {searchParams: searchParameters};

expectTypeOf(options.searchParams).toMatchTypeOf<SearchParamsOption>();
