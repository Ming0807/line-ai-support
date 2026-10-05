/** Public catalog routes only; opaque query values never become persisted provenance. */
export function hasPublicImportQuery(url:URL):boolean{
 if(url.search==='')return true;
 if(url.search.length>1024)return false;
 const entries=[...url.searchParams.entries()],seen=new Set<string>();
 if(entries.length<1||entries.length>8)return false;
 const official=url.hostname==='yru.ac.th'||url.hostname.endsWith('.yru.ac.th');
 for(const [key,value] of entries){
  if(seen.has(key)||value.length>40)return false;seen.add(key);
  if(!official){if(url.hostname!=='drive.google.com'||key!=='usp'||value!=='sharing')return false;continue;}
  if(['id','p','group','catid','Itemid','start','limit'].includes(key)){if(!/^(?:0|[1-9][0-9]{0,8})$/.test(value))return false;continue;}
  if(key==='view'&&['info_guide','guide','aor','doc_form','fee','standard','article','category','categories','featured'].includes(value))continue;
  if(key==='menu'&&value==='manual'||key==='page'&&value==='rule'||key==='t'&&value==='n4')continue;
  if(key==='option'&&['com_content','com_phocadownload','com_docman'].includes(value))continue;
  if(key==='layout'&&['blog','default'].includes(value)||key==='format'&&['html','pdf'].includes(value)||
   key==='lang'&&['th','en','th-TH','en-GB'].includes(value)||key==='tmpl'&&value==='component')continue;
  return false;
 }
 return true;
}
