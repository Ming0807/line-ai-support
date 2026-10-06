import type {PoolClient} from 'pg';
import {getInitialDocumentFamilies} from './family-catalog';
export interface FamilySeedResult {requested:number;existing:number;inserted:number;missingCodes:string[]}
/** Fixed reference data only. Caller owns the short transaction and environment guard. */
export async function seedInitialDocumentFamilies(client:PoolClient,apply:boolean):Promise<FamilySeedResult>{
 const families=getInitialDocumentFamilies(),codes=families.map(row=>row.code);
 const before=(await client.query(`select id,code,name,category,default_storage_mode,created_at,updated_at from public.document_families where code=any($1::text[]) order by code${apply?' for share':''}`,[codes])).rows;
 const existingCodes=new Set(before.map(row=>row.code));
 const missingCodes=codes.filter(code=>!existingCodes.has(code));
 if(!apply)return {requested:codes.length,existing:before.length,inserted:0,missingCodes};
 const inserted=await client.query(`insert into public.document_families(code,name,category)
  select code,name,category from jsonb_to_recordset($1::jsonb) as fixed(code text,name text,category text)
  on conflict(code) do nothing returning code`,[JSON.stringify(families)]);
 const after=(await client.query('select id,code,name,category,default_storage_mode,created_at,updated_at from public.document_families where code=any($1::text[]) order by code',[codes])).rows;
 if(after.length!==codes.length||before.some(row=>JSON.stringify(row)!==JSON.stringify(after.find(next=>next.code===row.code))))throw new Error('FAMILY_SEED_VERIFICATION_FAILED');
 return {requested:codes.length,existing:before.length,inserted:inserted.rowCount??0,missingCodes:[]};
}
