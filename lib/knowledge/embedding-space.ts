import {createHash} from 'node:crypto';
export const LOCAL_EMBEDDING_MODEL='intfloat/multilingual-e5-small';
export const LOCAL_EMBEDDING_REVISION='614241f622f53c4eeff9890bdc4f31cfecc418b3';
export const LOCAL_EMBEDDING_DIMENSION=384;
/** URL/key changes must not change the semantic vector space. */
export const LOCAL_EMBEDDING_FINGERPRINT=createHash('sha256').update(JSON.stringify([
 'LOCAL_E5',LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION,LOCAL_EMBEDDING_DIMENSION,'e5-query-passage-v1','l2-v1',
])).digest('hex');
