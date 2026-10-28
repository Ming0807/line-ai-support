/** Publishers and delivery readers use the same catalog → sorted families → sorted documents order. */
export const knowledgeDocumentLock=(documentId:string)=>`knowledge-document:${documentId}`;
export const knowledgeFamilyLock=(familyId:string)=>`knowledge-family:${familyId}`;
export const knowledgeStructuredCatalogLock='knowledge-structured-selection-catalog:v1';
