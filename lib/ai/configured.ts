import {getDatabasePool} from '../database/pool';
import {generate,type GenerateInput} from './gateway';
import {createAIStore} from './store';
import {createProviderRegistry,createEmbeddingProviderRegistry} from './provider-registry';
import {AIProviderError} from './types';
import {embed,type EmbedInput} from './embedding-gateway';

export function generateConfigured<T>(input:GenerateInput<T>){
 const key=process.env.ENCRYPTION_KEY;if(!key)throw new AIProviderError('PROVIDER_UNAVAILABLE');
 return generate(input,{key,store:createAIStore(getDatabasePool()),adapters:createProviderRegistry()});
}

export function embedConfigured(input:EmbedInput){
 const key=process.env.ENCRYPTION_KEY;if(!key)throw new AIProviderError('PROVIDER_UNAVAILABLE');
 return embed(input,{key,store:createAIStore(getDatabasePool()),adapters:createEmbeddingProviderRegistry()});
}
