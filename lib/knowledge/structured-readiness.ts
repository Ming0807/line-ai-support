import type {PoolClient} from 'pg';
import {availabilityDatasets,structuredAvailabilitySchema} from './structured-availability';
import {withImportAdminTransaction,type ImportStagingOptions} from '../imports/import-staging';
import {getStructuredRegistryEntry,type StructuredFieldKind} from './structured-registry';
/** Deployment observation only. Client input can never install schema or enable a mapper. */
export async function structuredInfrastructureReady(client:Pick<PoolClient,'query'>):Promise<boolean>{
 const tables=[...availabilityDatasets.map(name=>'public.'+name),'private.structured_publication_effects','private.structured_row_provenance'];
 const fenced=[...availabilityDatasets.map(name=>'public.'+name),'public.document_families','public.documents','public.document_relationships','public.departments'];
 const types:Record<StructuredFieldKind,string>={TEXT:'text',INTEGER:'integer',DATE:'date',TIMESTAMP:'timestamp with time zone',DECIMAL:'numeric',CURRENCY:'text',EMAIL:'text',URL:'text'};
 const columns=availabilityDatasets.flatMap(dataset=>[
  {table:'public.'+dataset,column:'id',type:'uuid',required:true},
  {table:'public.'+dataset,column:'document_id',type:'uuid',required:true},
  ...getStructuredRegistryEntry(dataset).fields.map(field=>({table:'public.'+dataset,column:field.name,
   type:dataset==='university_services'&&field.name==='opening_hours'?'jsonb':types[field.kind],required:!field.nullable})),
 ]);
 const guards=[
  ...fenced.map(table=>({table,name:'structured_selection_catalog',fn:'private.lock_structured_selection_catalog()',type:62,deferred:false})),
  ...availabilityDatasets.flatMap(dataset=>[
   {table:'public.'+dataset,name:dataset+'_source_guard',fn:'private.guard_structured_row()',type:31,deferred:false},
   {table:'public.'+dataset,name:dataset+'_effect_complete',fn:'private.check_structured_effect_trigger()',type:5,deferred:true},
  ]),
  {table:'private.structured_row_provenance',name:'structured_provenance_guard',fn:'private.guard_structured_provenance()',type:31,deferred:false},
  {table:'private.structured_publication_effects',name:'structured_effect_complete',fn:'private.check_structured_effect_trigger()',type:5,deferred:true},
  {table:'private.knowledge_import_publications',name:'publication_requires_structured_effect',fn:'private.check_structured_effect_trigger()',type:5,deferred:true},
 ];
 const row=(await client.query(`select
  (select count(*)=13 and bool_and(c.relrowsecurity) from unnest($1::text[]) as n(name) join pg_class c on c.oid=to_regclass(n.name) where c.relkind='r')
  and not exists(select 1 from jsonb_to_recordset($2::jsonb) as n("table" text,"column" text,"type" text,required boolean)
   where not exists(select 1 from pg_attribute a where a.attrelid=to_regclass(n."table") and a.attname=n."column" and not a.attisdropped
    and format_type(a.atttypid,a.atttypmod)=n."type" and a.attnotnull=n.required))
  and not exists(select 1 from jsonb_to_recordset($3::jsonb) as n("table" text,name text,fn text,"type" integer,deferred boolean)
   where not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass(n."table") and t.tgname=n.name
    and t.tgfoid=to_regprocedure(n.fn) and t.tgtype=n."type" and t.tgenabled in ('O','A')
    and t.tgdeferrable=n.deferred and t.tginitdeferred=n.deferred))
  and not exists(select 1 from unnest($4::text[]) n(name) where not exists(
   select 1 from pg_constraint c where c.conrelid=to_regclass(n.name) and c.contype='p' and c.convalidated))
  and exists(select 1 from pg_constraint where conrelid=to_regclass('private.knowledge_import_publications') and conname='publication_mode_embedding' and convalidated)
  ready`,[[...new Set([...tables,...fenced])],JSON.stringify(columns),JSON.stringify(guards),tables])).rows[0];
 return row?.ready===true;
}
export async function getStructuredAvailability(actor:string,options:ImportStagingOptions={}){
 return withImportAdminTransaction(actor,options,async client=>{const available=await structuredInfrastructureReady(client);return structuredAvailabilitySchema.parse({available,datasets:available?[...availabilityDatasets]:[],registryVersion:'structured-v1'});});
}
