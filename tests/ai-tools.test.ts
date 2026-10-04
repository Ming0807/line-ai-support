import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry, type ToolContext } from '../lib/ai/tools';

const context: ToolContext = {
  lineSessionId: '48eb6b5b-c479-4a5f-a4d9-353407693b28',
  conversationId: '1039b08e-4b19-4bf3-af15-7d78737db0a4',
  conversationRevision: 3,
};

describe('ToolRegistry', () => {
  it('accepts provider-required null for an optional field without changing backend optional semantics',async()=>{
    const execute=vi.fn(async(args:{query:string;limit?:number})=>args);
    const registry=new ToolRegistry().register('search_knowledge',z.strictObject({query:z.string(),limit:z.number().int().optional()}),execute,'Search');
    expect(await registry.execute({name:'search_knowledge',arguments:{query:'registration',limit:null}},context,['search_knowledge'])).toEqual({query:'registration'});
    expect(execute).toHaveBeenCalledExactlyOnceWith({query:'registration'},context);
  });
  it('executes an allowed registered tool with parsed arguments and trusted context', async () => {
    const execute = vi.fn(async (args: { query: string; limit?: number }, trusted: ToolContext) => ({ args, trusted }));
    const registry = new ToolRegistry().register('search_knowledge', z.strictObject({
      query: z.string().min(1), limit: z.number().int().positive().optional(),
    }), execute, 'Search the knowledge base');

    const result = await registry.execute({ name: 'search_knowledge', arguments: { query: 'registration', limit: 4 } }, context, ['search_knowledge']);

    expect(result).toEqual({ args: { query: 'registration', limit: 4 }, trusted: context });
    expect(execute).toHaveBeenCalledExactlyOnceWith({ query: 'registration', limit: 4 }, context);
  });

  it('normalizes nested optional values while preserving declared nullable values and rejecting extra keys', async () => {
    const registry = new ToolRegistry().register('search_knowledge', z.strictObject({
      filters: z.array(z.strictObject({department: z.string().optional(), year: z.number().nullable().optional()})),
    }), async args => args, 'Search');
    expect(await registry.execute({name: 'search_knowledge', arguments: {filters: [{department: null, year: null}]}}, context, ['search_knowledge']))
      .toEqual({filters: [{year: null}]});
    await expect(registry.execute({name: 'search_knowledge', arguments: JSON.parse('{"filters":[],"__proto__":null}')}, context, ['search_knowledge']))
      .rejects.toThrow('INVALID_ARGUMENTS');
    await expect(registry.execute({name: 'search_knowledge', arguments: {filters: null}}, context, ['search_knowledge']))
      .rejects.toThrow('INVALID_ARGUMENTS');
  });

  it('normalizes optional null arguments inside a declared union branch', async () => {
    const registry = new ToolRegistry().register('search_knowledge', z.strictObject({filter: z.union([
      z.strictObject({kind: z.literal('department'), code: z.string().optional()}),
      z.strictObject({kind: z.literal('year'), year: z.number()}),
    ])}), async args => args, 'Search');
    expect(await registry.execute({name: 'search_knowledge', arguments: {filter: {kind: 'department', code: null}}}, context, ['search_knowledge']))
      .toEqual({filter: {kind: 'department'}});
  });

  it('publishes strict JSON schema with every optional property required and nullable', () => {
    const registry = new ToolRegistry().register('search_structured', z.strictObject({
      query: z.string(), limit: z.number().int().optional(),
      filter: z.strictObject({ departmentCode: z.string().optional() }),
    }), async () => [], 'Search structured records');

    const definition = registry.definitions(['search_structured'])[0];
    const parameters = definition.parameters as { additionalProperties?: unknown; properties?: Record<string, { anyOf?: unknown[]; additionalProperties?: unknown; properties?: Record<string, { anyOf?: unknown[] }>; required?: string[] }>; required?: string[] };

    expect(parameters.additionalProperties).toBe(false);
    expect(parameters.required).toEqual(['query', 'limit', 'filter']);
    expect(parameters.properties?.limit.anyOf).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'null' })]));
    expect(parameters.properties?.filter.additionalProperties).toBe(false);
    expect(parameters.properties?.filter.required).toEqual(['departmentCode']);
    expect(parameters.properties?.filter.properties?.departmentCode.anyOf)
      .toEqual(expect.arrayContaining([expect.objectContaining({ type: 'null' })]));
  });

  it('rejects unregistered and malicious names without invoking a handler or echoing payloads', async () => {
    const execute = vi.fn(async () => 'never');
    const registry = new ToolRegistry().register('search_knowledge', z.strictObject({ query: z.string() }), execute, 'Search');

    await expect(registry.execute({ name: '__proto__', arguments: { secret: 'sensitive-model-payload' } }, context, ['search_knowledge']))
      .rejects.toThrow('UNKNOWN_TOOL');
    await expect(registry.execute({ name: 'search_knowledge', arguments: { query: 'x' } }, context, ['route_department']))
      .rejects.toThrow('TOOL_NOT_ALLOWED');
    expect(execute).not.toHaveBeenCalled();
    try {
      await registry.execute({ name: '__proto__', arguments: { secret: 'sensitive-model-payload' } }, context, ['search_knowledge']);
    } catch (error) {
      expect(String(error)).not.toContain('sensitive-model-payload');
    }
  });

  it('rejects invalid and extra arguments before execution', async () => {
    const execute = vi.fn(async () => 'never');
    const registry = new ToolRegistry().register('route_department', z.strictObject({ departmentCode: z.enum(['IT', 'LIBRARY']) }), execute, 'Route to department');

    await expect(registry.execute({ name: 'route_department', arguments: { departmentCode: 'IT', conversationId: context.conversationId } }, context, ['route_department']))
      .rejects.toThrow('INVALID_ARGUMENTS');
    await expect(registry.execute({ name: 'route_department', arguments: { departmentCode: 'FINANCE' } }, context, ['route_department']))
      .rejects.toThrow('INVALID_ARGUMENTS');
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects malformed trusted context before execution', async () => {
    const execute = vi.fn(async () => 'never');
    const registry = new ToolRegistry().register('create_ticket', z.strictObject({ summary: z.string() }), execute, 'Create a ticket');

    await expect(registry.execute({ name: 'create_ticket', arguments: { summary: 'Need help' } },
      { ...context, conversationRevision: -1 }, ['create_ticket'])).rejects.toThrow('INVALID_CONTEXT');
    await expect(registry.execute({ name: 'create_ticket', arguments: { summary: 'Need help' } },
      { ...context, lineSessionId: 'not-a-uuid' }, ['create_ticket'])).rejects.toThrow('INVALID_CONTEXT');
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not allow model argument schemas to expose trusted context fields', () => {
    const registry = new ToolRegistry();
    expect(() => registry.register('search_knowledge', z.strictObject({
      query: z.string(), conversationId: z.string().uuid(),
    }), async () => [], 'Search'))
      .toThrow('INVALID_SCHEMA');
  });

  it('replaces backend exceptions with a fixed non-sensitive tool failure', async () => {
    const registry = new ToolRegistry().register('search_knowledge', z.strictObject({ query: z.string() }),
      async () => { throw new Error('provider payload must not escape'); }, 'Search');

    await expect(registry.execute({ name: 'search_knowledge', arguments: { query: 'private question' } }, context, ['search_knowledge']))
      .rejects.toThrow('TOOL_EXECUTION_FAILED');
  });

  it('rejects schemas that strip or accept extra keys at any object depth', () => {
    const registry = new ToolRegistry();
    expect(() => registry.register('search_knowledge', z.object({ query: z.string() }), async () => [], 'Search'))
      .toThrow('INVALID_SCHEMA');
    expect(() => registry.register('search_structured', z.strictObject({ filter: z.object({ field: z.string() }) }), async () => [], 'Search'))
      .toThrow('INVALID_SCHEMA');
    expect(() => registry.register('route_department', z.looseObject({ departmentCode: z.string() }), async () => [], 'Route'))
      .toThrow('INVALID_SCHEMA');
  });

  it('rejects duplicate registration and registration of an unknown name', () => {
    const registry = new ToolRegistry().register('search_knowledge', z.strictObject({ query: z.string() }), async () => [], 'Search');
    expect(() => registry.register('search_knowledge', z.strictObject({ query: z.string() }), async () => [], 'Search again'))
      .toThrow('DUPLICATE_TOOL');
    expect(() => registry.register('drop_table' as never, z.strictObject({}), async () => [], 'Unknown'))
      .toThrow('UNKNOWN_TOOL');
  });
});
