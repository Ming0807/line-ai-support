/** Native OpenAI dimensions can shorten v3 vectors, never enlarge them. */
export function isEmbeddingDimensionAllowed(modelId:string,dimensions:number):boolean {
 if(!Number.isSafeInteger(dimensions)||dimensions<1||dimensions>4096)return false;
 if(modelId==='text-embedding-ada-002')return dimensions===1536;
 if(modelId==='text-embedding-3-small')return dimensions<=1536;
 if(modelId==='text-embedding-3-large')return dimensions<=3072;
 // Unknown future model size must remain explicitly configured and response-validated.
 return true;
}
