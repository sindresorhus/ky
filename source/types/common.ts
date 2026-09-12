// eslint-disable-next-line @typescript-eslint/no-restricted-types
export type Primitive = null | undefined | string | number | boolean | symbol | bigint;

export type LiteralUnion<LiteralType extends BaseType, BaseType extends Primitive> =
	| LiteralType
	| (BaseType & {_?: never});
