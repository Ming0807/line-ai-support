import {readSafeOfficeArchive} from './safe-archive';
import {parseSafeXml,xmlAttribute,type SafeXmlElement} from './safe-xml';
import {verifyImportSource} from './source';
import type {ImportSource} from './types';
export interface OfficeRelationship {readonly id:string;readonly type:string;readonly target:string|null;readonly external:boolean}
export interface OfficePackage {
 readonly mainPath:string;readonly main:SafeXmlElement;readonly parts:ReadonlyMap<string,SafeXmlElement>;
 readonly hasExternalLinks:boolean;relationships(partPath:string):readonly OfficeRelationship[];
}
const CONTENT_NS='http://schemas.openxmlformats.org/package/2006/content-types';
const PACKAGE_REL_NS='http://schemas.openxmlformats.org/package/2006/relationships';
const REL_CONTENT_TYPE='application/vnd.openxmlformats-package.relationships+xml';
const ACTIVE_RELATIONS=new Set(['oleobject','package','control','vbaproject','activexcontrol','activexcontrolbinary','macrosheet','dialogsheet']);
const REL_BASES=['http://schemas.openxmlformats.org/officeDocument/2006/relationships/','http://purl.oclc.org/ooxml/officeDocument/relationships/'];
const MAIN_TYPES={DOCX:'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',XLSX:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'};
const invalid=():never=>{throw new Error('IMPORT_PARSE_INVALID');};
function pathPart(value:string):string{
 if(!value||value.length>1024||value.normalize('NFC')!==value||/[\\%?#:\x00-\x1f\x7f]/.test(value)||value.startsWith('/'))return invalid();
 if(value.split('/').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)))return invalid();return value;
}
function elementChildren(node:SafeXmlElement):SafeXmlElement[]{
 if(node.children.some(child=>typeof child==='string'&&child.trim()))return invalid();
 return node.children.filter((child):child is SafeXmlElement=>typeof child!=='string');
}
function required(node:SafeXmlElement,key:string):string{const value=xmlAttribute(node,key);if(!value)return invalid();return value;}
function targetPath(owner:string,target:string):string{
 if(!target||target.length>1024||/[\\%?#:\x00-\x1f\x7f]/.test(target))return invalid();
 const base=target.startsWith('/')?[]:owner.split('/').slice(0,-1);
 for(const segment of target.replace(/^\//,'').split('/')){
  if(!segment)return invalid();if(segment==='.')continue;
  if(segment==='..'){if(!base.length)return invalid();base.pop();}else base.push(segment);
 }
 return pathPart(base.join('/'));
}
function relationshipOwner(path:string):string{
 if(path==='_rels/.rels')return '';
 const match=/^(?:(.*)\/)?_rels\/([^/]+)\.rels$/.exec(path);if(!match)return invalid();
 return pathPart((match[1]?`${match[1]}/`:'')+match[2]);
}
/** Buffer-only Open Packaging Convention validation. External references are evidence, never resources. */
export async function readOfficePackage(source:ImportSource,signal?:AbortSignal):Promise<OfficePackage>{
 try{
  const verified=verifyImportSource(source);if(verified.format!=='DOCX'&&verified.format!=='XLSX'||signal?.aborted)return invalid();
  const raw=await readSafeOfficeArchive(verified.bytes,signal);
  const contentBytes=raw.get('[Content_Types].xml');if(!contentBytes)return invalid();
  const content=parseSafeXml(contentBytes);if(content.local!=='Types'||content.uri!==CONTENT_NS)return invalid();
  const defaults=new Map<string,string>(),overrides=new Map<string,string>();
  for(const child of elementChildren(content)){
   if(child.uri!==CONTENT_NS||elementChildren(child).length)return invalid();
   const type=required(child,'ContentType');
   if(type.length>200||!/^[-+.a-zA-Z0-9]+\/[-+.a-zA-Z0-9]+$/.test(type)||/macroenabled|vba|activex|oleobject/i.test(type))return invalid();
   if(child.local==='Default'){
    const extension=required(child,'Extension').toLowerCase();if(!/^[a-z0-9]{1,32}$/.test(extension)||defaults.has(extension))return invalid();defaults.set(extension,type);
   }else if(child.local==='Override'){
    const name=required(child,'PartName');if(!name.startsWith('/'))return invalid();const path=pathPart(name.slice(1));
    if(overrides.has(path)||!raw.has(path))return invalid();overrides.set(path,type);
   }else return invalid();
  }
  const parts=new Map<string,SafeXmlElement>();let nodes=0,characters=0;
  const count=(root:SafeXmlElement)=>{
   const pending=[root];while(pending.length){
    const current=pending.pop()!;if(++nodes>250_000)return invalid();
    characters+=current.attributes.reduce((sum,attribute)=>sum+attribute.value.length,0);
    for(const child of current.children)if(typeof child==='string')characters+=child.length;else pending.push(child);
    if(characters>10_000_000)return invalid();
   }
  };
  for(const [path,bytes] of raw){
   if(signal?.aborted)return invalid();if(path==='[Content_Types].xml')continue;
   const extension=path.split('.').at(-1)?.toLowerCase()??'',type=overrides.get(path)??defaults.get(extension);
   if(!type)return invalid();
   if(extension==='rels'&&(type!==REL_CONTENT_TYPE||!path.endsWith('.rels'))||type===REL_CONTENT_TYPE&&extension!=='rels')return invalid();
   const isXml=type==='application/xml'||type==='text/xml'||type.endsWith('+xml');
   if(!isXml&&!['image/png','image/jpeg','image/gif','image/tiff','image/bmp','image/x-emf','image/x-wmf'].includes(type))return invalid();
   if((extension==='xml'||extension==='rels')&&!isXml)return invalid();
   if(isXml){const root=parseSafeXml(bytes);count(root);parts.set(path,root);}
  }
  const byOwner=new Map<string,readonly OfficeRelationship[]>();let hasExternalLinks=false,relations=0;
  for(const [path,root] of parts){
   if(!path.endsWith('.rels'))continue;
   const owner=relationshipOwner(path);if(owner&&!raw.has(owner)||byOwner.has(owner))return invalid();
   if(root.local!=='Relationships'||root.uri!==PACKAGE_REL_NS)return invalid();
   const ids=new Set<string>(),list:OfficeRelationship[]=[];
   for(const child of elementChildren(root)){
    if(child.local!=='Relationship'||child.uri!==PACKAGE_REL_NS||elementChildren(child).length||++relations>2000)return invalid();
    const id=required(child,'Id'),type=required(child,'Type'),mode=xmlAttribute(child,'TargetMode'),originalTarget=required(child,'Target');
    if(!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(id)||ids.has(id)||type.length>512||!/^(?:https?):\/\/[^\s?#]+$/.test(type)||mode!==null&&mode!=='External'&&mode!=='Internal')return invalid();
    if(ACTIVE_RELATIONS.has(type.split('/').at(-1)?.toLowerCase()??''))return invalid();
    ids.add(id);const external=mode==='External';let target:string|null=null;
    if(external){if(originalTarget.length>2048||/[\x00-\x20\x7f]/.test(originalTarget))return invalid();hasExternalLinks=true;}
    else{target=targetPath(owner,originalTarget);if(!raw.has(target))return invalid();}
    list.push(Object.freeze({id,type,target,external}));
   }
   byOwner.set(owner,Object.freeze(list));
  }
  const mains=(byOwner.get('')??[]).filter(relation=>REL_BASES.some(base=>relation.type===`${base}officeDocument`));
  if(mains.length!==1||mains[0].external||!mains[0].target)return invalid();const mainPath=mains[0].target;
  if(overrides.get(mainPath)!==MAIN_TYPES[verified.format])return invalid();const main=parts.get(mainPath);if(!main)return invalid();
  return Object.freeze({mainPath,main,parts,hasExternalLinks,relationships:(path:string)=>byOwner.get(path)??Object.freeze([])});
 }catch{return invalid();}
}
