// eslint-disable-next-line @typescript-eslint/no-restricted-types
export const isObject = (value: unknown): value is object => value !== null && typeof value === 'object';
