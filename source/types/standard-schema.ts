export type StandardSchemaV1Issue = {
	readonly message: string;
	readonly path?: ReadonlyArray<PropertyKey | {readonly key: PropertyKey}> | undefined;
};

export type StandardSchemaV1SuccessResult<OutputType> = {
	readonly value: OutputType;
	readonly issues?: undefined;
};

export type StandardSchemaV1FailureResult = {
	readonly issues: readonly StandardSchemaV1Issue[];
	readonly value?: undefined;
};

export type StandardSchemaV1Result<OutputType> = StandardSchemaV1SuccessResult<OutputType> | StandardSchemaV1FailureResult;

export type StandardSchemaV1Types<InputType, OutputType> = {
	readonly input: InputType;
	readonly output: OutputType;
};

export type StandardSchemaV1Options = {
	readonly libraryOptions?: Readonly<Record<string, unknown>> | undefined;
};

export type StandardSchemaV1<InputType = unknown, OutputType = InputType> = {
	readonly '~standard': {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (
			value: unknown,
			options?: StandardSchemaV1Options,
		) => StandardSchemaV1Result<OutputType> | Promise<StandardSchemaV1Result<OutputType>>;
		readonly types?: StandardSchemaV1Types<InputType, OutputType> | undefined;
	};
};

export type StandardSchemaV1InferOutput<Schema extends StandardSchemaV1> = Schema['~standard'] extends {
	readonly types: StandardSchemaV1Types<unknown, infer OutputType>;
}
	? OutputType
	: Extract<
		Awaited<ReturnType<Schema['~standard']['validate']>>,
		StandardSchemaV1SuccessResult<unknown>
	> extends StandardSchemaV1SuccessResult<infer OutputType>
		? OutputType
		: unknown;
