import type {AISnapshot} from '../ai/run-worker';
import type {GenerateInput} from '../ai/gateway';
import {z} from 'zod';
import {ragAnswerSchema, ragCompletionSchema, buildCitedAnswer} from './citations';
import {answerMessages, bounded, promptFits, validEvidence} from './answer-producer';
import type {KnowledgeEvidence, KnowledgeScope} from './types';

type RagAnswer = z.infer<typeof ragAnswerSchema>;

/** CONV-V2-04 compose call: one bounded answer over already selected, fenced evidence. */
const COMPOSE_TIMEOUT_MS = 20_000;

const INCOMPLETE_SECTION_NOTE = 'Some procedure sections could not be supplied completely. '
  + 'If the answer describes steps, state plainly in one short sentence that the official guide may contain further steps, '
  + 'without inventing them.';

export type SectionComposeResult =
  | {status: 'READY'; output: RagAnswer}
  /** The model found no supported answer in this evidence; the caller may try the full lookup path. */
  | {status: 'NO_ANSWER'}
  /** Invalid output, unsupported citation, prompt too large or provider failure. */
  | {status: 'FAILED'};

export interface SectionComposerOptions {
  generate(input: GenerateInput<unknown>): Promise<{output: unknown; toolCalls: unknown[]}>;
}

export function createSectionComposer(options: SectionComposerOptions) {
  return async (
    snapshot: AISnapshot,
    scope: KnowledgeScope,
    evidence: KnowledgeEvidence[],
    incompleteSections: number,
    signal: AbortSignal,
  ): Promise<SectionComposeResult> => {
    if (!validEvidence(evidence)) return {status: 'FAILED'};
    const messages = answerMessages(snapshot, scope, evidence);
    if (incompleteSections > 0) messages[0] = {...messages[0], content: `${messages[0].content}\n${INCOMPLETE_SECTION_NOTE}`};
    if (!promptFits(messages)) return {status: 'FAILED'};

    let completion: {output: unknown; toolCalls: unknown[]};
    try {
      completion = await bounded(stageSignal => options.generate({
        taskType: 'TURN_COMPOSE',
        messages,
        responseSchema: ragCompletionSchema,
        responseName: 'turn_compose',
        tools: [],
        timeoutMs: COMPOSE_TIMEOUT_MS,
        conversationId: snapshot.conversationId,
        signal: stageSignal,
      }), COMPOSE_TIMEOUT_MS, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      return {status: 'FAILED'};
    }
    if (completion.toolCalls.length > 0) return {status: 'FAILED'};
    const proposed = ragCompletionSchema.safeParse(completion.output);
    if (!proposed.success) return {status: 'FAILED'};
    if (proposed.data.answer === null) return {status: 'NO_ANSWER'};
    const answer = ragAnswerSchema.safeParse(proposed.data);
    if (!answer.success) return {status: 'FAILED'};
    try {
      // Same citation, link and packet-size validation the finalizer repeats before delivery.
      buildCitedAnswer(answer.data, evidence);
    } catch {
      return {status: 'FAILED'};
    }
    return {status: 'READY', output: answer.data};
  };
}
