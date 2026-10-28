import {z} from 'zod';
import type {DbClient} from '../tickets/authorization';
import {copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';

const entry=z.object({code:z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/u),name:z.string().min(1).max(500),category:z.string().min(1).max(80)}).strict();
const catalogSchema=z.array(entry).max(50).refine(rows=>new Set(rows.map(row=>row.code)).size===rows.length);
export type PublicFamilyCatalog=ReadonlyArray<Readonly<z.infer<typeof entry>>>;
/** Navigation metadata only; never evidence of a rule or personal applicability. No partial catalog. */
export function parsePublicFamilyCatalog(input:unknown):PublicFamilyCatalog|null{
 if(input===null)return null;
 try{
  const copied=copyStructuredJson(input,256*1024,4096);
  if(Array.isArray(copied)&&(copied.length>50||JSON.stringify(copied).length>10000))return null;
  return freezeStructuredData(catalogSchema.parse(copied));
 }catch{throw new Error('KNOWLEDGE_CATALOG_INVALID');}
}
/** Caller establishes actor/source authority and owns the transaction; no provider work here. */
export async function readPublicFamilyCatalog(client:DbClient):Promise<PublicFamilyCatalog|null>{
 const rows=(await client.query(`select f.code,min(d.title) name,f.category from public.document_families f
  join public.documents d on d.document_family_id=f.id
  where d.approval_status='APPROVED' and d.visibility='PUBLIC' and d.official_source and d.extraction_reviewed
   and not d.requires_review and d.authority_level>0 and d.status='ACTIVE' and d.is_current and not d.archive_only
  group by f.code,f.category order by f.code limit 51`)).rows;
 return parsePublicFamilyCatalog(rows);
}
export function familySelectionIsKnown(codes:readonly string[],catalog:PublicFamilyCatalog):boolean{
 const allowed=new Set(catalog.map(family=>family.code));
 return new Set(codes).size===codes.length&&codes.every(code=>allowed.has(code));
}
