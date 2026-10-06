import {catalogQuerySchema,catalogPageSchema,catalogRelationsQuerySchema} from './catalog-types';
import {ImportStagingError} from '../imports/import-staging';
function selectors(request:Request,allowed:readonly string[]):URLSearchParams{
 const query=new URL(request.url).searchParams,seen=new Set<string>();
 for(const key of query.keys()){if(!allowed.includes(key)||seen.has(key))throw new ImportStagingError('INVALID_REQUEST');seen.add(key);}
 return query;
}
function number(query:URLSearchParams,key:string,fallback:number){
 const raw=query.get(key);if(raw===null)return fallback;
 if(!/^[1-9][0-9]{0,4}$/.test(raw))throw new ImportStagingError('INVALID_REQUEST');return Number(raw);
}
export function readCatalogQuery(request:Request){
 const query=selectors(request,['q','departmentCode','status','page','pageSize']);
 const parsed=catalogQuerySchema.safeParse({q:query.get('q'),departmentCode:query.get('departmentCode'),status:query.get('status'),page:number(query,'page',1),pageSize:number(query,'pageSize',10)});
 if(!parsed.success)throw new ImportStagingError('INVALID_REQUEST');return parsed.data;
}
export function readCatalogPage(request:Request){
 const query=selectors(request,['page','pageSize']);const parsed=catalogPageSchema.safeParse({page:number(query,'page',1),pageSize:number(query,'pageSize',25)});
 if(!parsed.success)throw new ImportStagingError('INVALID_REQUEST');return parsed.data;
}
export function readCatalogRelations(request:Request){
 const query=selectors(request,['relationsPage','relationsPageSize']);const parsed=catalogRelationsQuerySchema.safeParse({relationsPage:number(query,'relationsPage',1),relationsPageSize:number(query,'relationsPageSize',25)});
 if(!parsed.success)throw new ImportStagingError('INVALID_REQUEST');return parsed.data;
}
