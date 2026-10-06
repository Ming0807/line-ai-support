import type {ImportPublicationReceipt} from './import-publication';

const receiptKeys=['jobId','jobRevision','extractionRevision','reviewRevision','documentId','familyId','storageMode','action','relationship','planDigest','createdAt'] as const;
const receiptActions=['NEW_FAMILY','ADD_ADDITIONAL','REPLACE_CURRENT','ADD_HISTORICAL','AMEND_EXISTING'] as const;
const storageModes=['RAG','STRUCTURED','BOTH'] as const;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest=/^[a-f0-9]{64}$/;

function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function hasExactKeys(value:Record<string,unknown>,keys:readonly string[]){return Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function validCounter(value:unknown):value is number{return Number.isInteger(value)&&Number(value)>=1&&Number(value)<=999_999_999;}
function isReceipt(value:unknown,jobId:string):value is ImportPublicationReceipt{
 if(!isRecord(value)||!hasExactKeys(value,receiptKeys))return false;
 if(typeof value.jobId!=='string'||value.jobId!==jobId||!uuid.test(value.jobId)||!validCounter(value.jobRevision)||!validCounter(value.extractionRevision)||!validCounter(value.reviewRevision))return false;
 if(typeof value.documentId!=='string'||!uuid.test(value.documentId)||typeof value.familyId!=='string'||!uuid.test(value.familyId))return false;
 if(typeof value.storageMode!=='string'||!storageModes.includes(value.storageMode as (typeof storageModes)[number])||typeof value.action!=='string'||!receiptActions.includes(value.action as (typeof receiptActions)[number]))return false;
 if(value.relationship!=='CANCELS'&&value.relationship!==null)return false;
 if(value.relationship==='CANCELS'&&value.action!=='ADD_ADDITIONAL')return false;
 if(typeof value.planDigest!=='string'||!digest.test(value.planDigest)||typeof value.createdAt!=='string')return false;
 const date=new Date(value.createdAt);
 return Number.isFinite(date.getTime())&&date.toISOString()===value.createdAt;
}

/** Strictly recognizes the private receipt-read DTO and binds it to its route job. */
export function isReceiptEnvelope(value:unknown,jobId:string):value is {publication:{receipt:ImportPublicationReceipt|null}}{
 if(!isRecord(value)||!hasExactKeys(value,['publication'])||!isRecord(value.publication)||!hasExactKeys(value.publication,['receipt']))return false;
 return value.publication.receipt===null||isReceipt(value.publication.receipt,jobId);
}

/** Strictly recognizes a completed POST result, including its replay flag and route-job binding. */
export function isPublicationResult(value:unknown,jobId:string):value is {publication:{receipt:ImportPublicationReceipt;replayed:boolean}}{
 if(!isRecord(value)||!hasExactKeys(value,['publication'])||!isRecord(value.publication)||!hasExactKeys(value.publication,['receipt','replayed']))return false;
 return typeof value.publication.replayed==='boolean'&&isReceipt(value.publication.receipt,jobId);
}
