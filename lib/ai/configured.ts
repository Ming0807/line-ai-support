import {getDatabasePool} from '../database/pool';
import {generate,type GenerateInput} from './gateway';
import {createAIStore} from './store';
import {createProviderRegistry} from './provider-registry';
import {AIProviderError} from './types';
import type {EmbedInput} from './embedding-gateway';
import {embedLocalConfigured} from '../knowledge/embedding-client';

export function generateConfigured<T>(input:GenerateInput<T>){
 const key=process.env.ENCRYPTION_KEY;if(!key)throw new AIProviderError('PROVIDER_UNAVAILABLE');
 return generate(input,{key,store:createAIStore(getDatabasePool()),adapters:createProviderRegistry()});
}

export function embedConfigured(input:EmbedInput){
 return embedLocalConfigured(input);
}
