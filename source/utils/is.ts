// eslint-disable-next-line @typescript-eslint/ban-types
export const isObject = (value: unknown): value is object => value !== null && typeof value === 'object';
