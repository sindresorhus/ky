import type {StandardSchemaV1Issue} from '../types/standard-schema.js';

export class SchemaValidationError extends Error {
	public readonly issues: readonly StandardSchemaV1Issue[];

	constructor(issues: readonly StandardSchemaV1Issue[]) {
		super('Response schema validation failed');
		this.name = 'SchemaValidationError';
		this.issues = issues;
	}
}
