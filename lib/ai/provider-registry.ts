import {createOpenAIAdapter} from './providers/openai';
import type {AIProviderAdapter} from './types';

/** Only backend-installed adapters are selectable; database text never loads executable code. */
export function createProviderRegistry(options:{fetchImpl?:typeof fetch}={}):Record<string,AIProviderAdapter>{
 return {OPENAI:createOpenAIAdapter(options)};
}
