import { expect, it } from 'vitest';
import { createModelSchema, updateModelSchema } from '../types/providers';

const existingModelInput = {
  modelId: 'test-model',
  displayName: 'Test model',
  supportsTools: true,
  supportsJson: true,
  supportsVision: false,
  enabled: true,
  priority: 10,
  timeoutMs: 12000,
  inputPricePerMillion: null,
  outputPricePerMillion: null,
};

it('defaults legacy create and update payloads to generation with no embedding dimensions', () => {
  expect(createModelSchema.parse(existingModelInput)).toMatchObject({
    purpose: 'GENERATION',
    embeddingDimensions: null,
  });
  expect(updateModelSchema.parse({ ...existingModelInput, revision: 3 })).toMatchObject({
    purpose: 'GENERATION',
    embeddingDimensions: null,
  });
});

it('accepts an embedding model with explicit dimensions and generation capabilities disabled', () => {
  const input = {
    ...existingModelInput,
    supportsTools: false,
    supportsJson: false,
    supportsVision: false,
    purpose: 'EMBEDDING',
    embeddingDimensions: 1536,
  };

  expect(createModelSchema.parse(input)).toMatchObject({
    purpose: 'EMBEDDING',
    embeddingDimensions: 1536,
    supportsTools: false,
    supportsJson: false,
    supportsVision: false,
  });
});

it.each([1, 4096])('accepts embedding dimension boundary %i', embeddingDimensions => {
  const input = {
    ...existingModelInput,
    supportsTools: false,
    supportsJson: false,
    supportsVision: false,
    purpose: 'EMBEDDING',
    embeddingDimensions,
  };

  expect(createModelSchema.parse(input).embeddingDimensions).toBe(embeddingDimensions);
});

it.each([
  ['text-embedding-ada-002', 1536],
  ['text-embedding-3-small', 1536],
  ['text-embedding-3-large', 3072],
] as const)('accepts the native maximum for %s', (modelId, embeddingDimensions) => {
  const input = {
    ...existingModelInput,
    modelId,
    supportsTools: false,
    supportsJson: false,
    supportsVision: false,
    purpose: 'EMBEDDING',
    embeddingDimensions,
  };

  expect(createModelSchema.parse(input).embeddingDimensions).toBe(embeddingDimensions);
});

it.each([
  ['dimensions are missing', { purpose: 'EMBEDDING' }],
  ['dimensions are null', { purpose: 'EMBEDDING', embeddingDimensions: null }],
  ['dimensions are below the allowed range', { purpose: 'EMBEDDING', embeddingDimensions: 0 }],
  ['dimensions are not an integer', { purpose: 'EMBEDDING', embeddingDimensions: 1.5 }],
  ['dimensions are above the allowed range', { purpose: 'EMBEDDING', embeddingDimensions: 4097 }],
  ['tools are enabled for an embedding model', { purpose: 'EMBEDDING', embeddingDimensions: 1536, supportsTools: true }],
  ['JSON mode is enabled for an embedding model', { purpose: 'EMBEDDING', embeddingDimensions: 1536, supportsJson: true }],
  ['vision is enabled for an embedding model', { purpose: 'EMBEDDING', embeddingDimensions: 1536, supportsVision: true }],
  ['dimensions are set for a generation model', { purpose: 'GENERATION', embeddingDimensions: 1536 }],
  ['purpose is unknown', { purpose: 'CHAT' }],
  ['ada-002 dimensions differ from its fixed vector size', { modelId: 'text-embedding-ada-002', purpose: 'EMBEDDING', embeddingDimensions: 2,
    supportsTools: false, supportsJson: false, supportsVision: false }],
  ['3-small dimensions exceed its maximum', { modelId: 'text-embedding-3-small', purpose: 'EMBEDDING', embeddingDimensions: 4096,
    supportsTools: false, supportsJson: false, supportsVision: false }],
  ['3-large dimensions exceed its maximum', { modelId: 'text-embedding-3-large', purpose: 'EMBEDDING', embeddingDimensions: 3073,
    supportsTools: false, supportsJson: false, supportsVision: false }],
] as const)('rejects incoherent model purpose configuration when %s', (_reason, overrides) => {
  const input = { ...existingModelInput, ...overrides };
  expect(createModelSchema.safeParse(input).success).toBe(false);
  expect(updateModelSchema.safeParse({ ...input, revision: 1 }).success).toBe(false);
});
