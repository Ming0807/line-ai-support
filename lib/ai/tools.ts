import { z } from 'zod';
import type { AITool } from './types';

export const controlledToolNames = ['search_knowledge', 'search_structured', 'route_department', 'create_ticket'] as const;
export type ControlledToolName = typeof controlledToolNames[number];

export interface ToolContext {
  lineSessionId: string;
  conversationId: string;
  conversationRevision: number;
}

const contextSchema = z.strictObject({
  lineSessionId: z.uuid(),
  conversationId: z.uuid(),
  conversationRevision: z.number().int().nonnegative(),
});
const reservedContextFields = new Set(['lineSessionId', 'conversationId', 'conversationRevision']);
const knownNames = new Set<string>(controlledToolNames);

type ToolExecutor<T> = (args: T, context: ToolContext) => Promise<unknown>;
interface ToolEntry<T = unknown> {
  schema: z.ZodType<T>;
  executor: ToolExecutor<T>;
  definition: AITool;
}
interface ZodInternal {
  _zod?: { def?: unknown };
}
interface ZodDefinition {
  type?: unknown;
  shape?: Record<string, z.ZodType>;
  catchall?: z.ZodType;
  [key: string]: unknown;
}

export class ToolRegistryError extends Error {
  constructor(readonly code: 'UNKNOWN_TOOL'|'TOOL_NOT_REGISTERED'|'TOOL_NOT_ALLOWED'|'INVALID_ARGUMENTS'|'INVALID_CONTEXT'|'INVALID_SCHEMA'|'DUPLICATE_TOOL'|'TOOL_EXECUTION_FAILED') {
    super(code);
    this.name = 'ToolRegistryError';
  }
}

function toolError(code: ConstructorParameters<typeof ToolRegistryError>[0]): ToolRegistryError {
  return new ToolRegistryError(code);
}

function definitionOf(schema: z.ZodType): Record<string, unknown> {
  const internal = (schema as z.ZodType & ZodInternal)._zod;
  const definition = internal?.def as ZodDefinition | undefined;
  if (!definition) throw toolError('INVALID_SCHEMA');
  return definition as Record<string, unknown>;
}

function isZodType(value: unknown): value is z.ZodType {
  return typeof value === 'object' && value !== null && '_zod' in value;
}

function validateStrictSchema(schema: z.ZodType): void {
  const visited = new Set<object>();
  const visit = (node: z.ZodType): void => {
    if (visited.has(node)) return;
    visited.add(node);
    const definition = definitionOf(node) as ZodDefinition;
    if (definition.type === 'object') {
      const catchall = definition.catchall;
      if (!isZodType(catchall) || definitionOf(catchall).type !== 'never') throw toolError('INVALID_SCHEMA');
      const shape = definition.shape;
      if (!shape || typeof shape !== 'object') throw toolError('INVALID_SCHEMA');
      for (const [key, child] of Object.entries(shape)) {
        if (reservedContextFields.has(key)) throw toolError('INVALID_SCHEMA');
        visit(child);
      }
      return;
    }
    if (definition.type === 'record' || definition.type === 'map') throw toolError('INVALID_SCHEMA');
    for (const value of Object.values(definition)) {
      if (isZodType(value)) visit(value);
      else if (Array.isArray(value)) {
        for (const child of value) if (isZodType(child)) visit(child);
      } else if (typeof value === 'object' && value !== null) {
        for (const child of Object.values(value)) if (isZodType(child)) visit(child);
      }
    }
  };
  visit(schema);
  if (definitionOf(schema).type !== 'object') throw toolError('INVALID_SCHEMA');
}

function normalizeStrictJsonSchema(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw toolError('INVALID_SCHEMA');
  const schema = structuredClone(value) as Record<string, unknown>;
  if (schema.type !== 'object' || typeof schema.properties !== 'object' || schema.properties === null || Array.isArray(schema.properties)) {
    throw toolError('INVALID_SCHEMA');
  }
  const normalize = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(normalize);
    if (typeof node !== 'object' || node === null) return node;
    const current = node as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(current)) copy[key] = normalize(child);
    if (copy.type === 'object' && typeof copy.properties === 'object' && copy.properties !== null && !Array.isArray(copy.properties)) {
      const properties = copy.properties as Record<string, unknown>;
      const originallyRequired = new Set(Array.isArray(copy.required) ? copy.required.filter((item): item is string => typeof item === 'string') : []);
      for (const [key, property] of Object.entries(properties)) {
        if (!originallyRequired.has(key) && !acceptsNull(property)) {
          properties[key] = { anyOf: [property, { type: 'null' }] };
        }
      }
      copy.required = Object.keys(properties);
      copy.additionalProperties = false;
    }
    return copy;
  };
  const normalized = normalize(schema);
  if (typeof normalized !== 'object' || normalized === null || Array.isArray(normalized)) throw toolError('INVALID_SCHEMA');
  const result = normalized as Record<string, unknown>;
  delete result.$schema;
  return result;
}

function acceptsNull(schema: unknown): boolean {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return false;
  const value = schema as Record<string, unknown>;
  if (value.type === 'null' || (Array.isArray(value.type) && value.type.includes('null'))) return true;
  return Array.isArray(value.anyOf) && value.anyOf.some(acceptsNull)
    || Array.isArray(value.oneOf) && value.oneOf.some(acceptsNull);
}

function toDefinition(name: ControlledToolName, schema: z.ZodType, description: string): AITool {
  validateStrictSchema(schema);
  if (typeof description !== 'string' || description.trim().length === 0) throw toolError('INVALID_SCHEMA');
  try {
    const jsonSchema = z.toJSONSchema(schema);
    return { name, description, parameters: normalizeStrictJsonSchema(jsonSchema) };
  } catch {
    throw toolError('INVALID_SCHEMA');
  }
}

/** Strict provider schemas encode optional arguments as required nullable fields. */
function normalizeOptionalArguments(schema: z.ZodType, value: unknown, depth = 0): unknown {
  if (depth > 40) throw toolError('INVALID_ARGUMENTS');
  const definition = definitionOf(schema);
  if (isZodType(definition.innerType)) return normalizeOptionalArguments(definition.innerType, value, depth + 1);
  if (definition.type === 'union' && Array.isArray(definition.options)) {
    for (const branch of definition.options) {
      if (!isZodType(branch)) continue;
      const candidate = normalizeOptionalArguments(branch, value, depth + 1);
      if (branch.safeParse(candidate).success) return candidate;
    }
    return value;
  }
  if (definition.type === 'array' && Array.isArray(value) && isZodType(definition.element)) {
    return value.map(item => normalizeOptionalArguments(definition.element as z.ZodType, item, depth + 1));
  }
  if (definition.type !== 'object' || typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const shape = definition.shape as Record<string, z.ZodType>;
  const normalized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const child = Object.hasOwn(shape, key) ? shape[key] : undefined;
    if (child && item === null && child.safeParse(undefined).success && !child.safeParse(null).success) continue;
    Object.defineProperty(normalized, key, {value: child ? normalizeOptionalArguments(child, item, depth + 1) : item, enumerable: true});
  }
  return normalized;
}

export class ToolRegistry {
  private readonly entries = new Map<ControlledToolName, ToolEntry>();

  register<T>(name: ControlledToolName, schema: z.ZodType<T>, executor: ToolExecutor<T>, description: string): this {
    if (typeof name !== 'string' || !knownNames.has(name)) throw toolError('UNKNOWN_TOOL');
    if (this.entries.has(name)) throw toolError('DUPLICATE_TOOL');
    const definition = toDefinition(name, schema, description);
    this.entries.set(name, { schema, executor, definition } as ToolEntry);
    return this;
  }

  definitions(allowed: ControlledToolName[]): AITool[] {
    const definitions: AITool[] = [];
    const seen = new Set<ControlledToolName>();
    for (const name of allowed) {
      if (typeof name !== 'string' || !knownNames.has(name)) throw toolError('UNKNOWN_TOOL');
      if (seen.has(name)) continue;
      const entry = this.entries.get(name);
      if (!entry) throw toolError('TOOL_NOT_REGISTERED');
      seen.add(name);
      definitions.push(structuredClone(entry.definition));
    }
    return definitions;
  }

  async execute(call: { name: string; arguments: unknown }, context: ToolContext, allowed: ControlledToolName[]): Promise<unknown> {
    if (!call || typeof call.name !== 'string' || !knownNames.has(call.name)) throw toolError('UNKNOWN_TOOL');
    const name = call.name as ControlledToolName;
    if (!allowed.includes(name)) throw toolError('TOOL_NOT_ALLOWED');
    const entry = this.entries.get(name);
    if (!entry) throw toolError('TOOL_NOT_REGISTERED');
    const parsedContext = contextSchema.safeParse(context);
    if (!parsedContext.success) throw toolError('INVALID_CONTEXT');
    const parsedArguments = entry.schema.safeParse(normalizeOptionalArguments(entry.schema, call.arguments));
    if (!parsedArguments.success) throw toolError('INVALID_ARGUMENTS');
    try {
      return await entry.executor(parsedArguments.data, parsedContext.data);
    } catch {
      throw toolError('TOOL_EXECUTION_FAILED');
    }
  }
}
