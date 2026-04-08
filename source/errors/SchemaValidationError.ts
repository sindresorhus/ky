import type {StandardSchemaV1Issue} from '../types/standard-schema.js';

/**
The error thrown when [Standard Schema](https://github.com/standard-schema/standard-schema) validation fails in `.json(schema)`. It has an `issues` property with the validation issues from the schema.

This error intentionally does not extend `KyError` because it does not represent a failure in Ky's HTTP lifecycle. The request succeeded; the user's schema rejected the data. As such, it is not matched by `isKyError()`.

@example
```
import ky, {SchemaValidationError} from 'ky';
import {z} from 'zod';

const userSchema = z.object({name: z.string()});

try {
	const user = await ky('/api/user').json(userSchema);
	console.log(user.name);
} catch (error) {
	if (error instanceof SchemaValidationError) {
		console.error(error.issues);
	}
}
```
*/
export class SchemaValidationError extends Error {
	override name = 'SchemaValidationError' as const;
	readonly issues: readonly StandardSchemaV1Issue[];

	constructor(issues: readonly StandardSchemaV1Issue[]) {
		super('Response schema validation failed');
		this.issues = issues;
	}
}
