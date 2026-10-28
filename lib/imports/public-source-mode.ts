/** Narrow first factual transcription path; ordinary RAG keeps its existing policy. */
export function publicSourceModeAllowed(input:{storageMode:string|null;documentType:string|null;datasetType?:string|null},hasTranscription=false):boolean{
 return input.storageMode==='RAG'?!hasTranscription:input.storageMode==='STRUCTURED'&&input.documentType==='GUIDE'&&input.datasetType==='university_services'&&hasTranscription;
}
