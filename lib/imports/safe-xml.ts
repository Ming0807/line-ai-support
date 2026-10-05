import {SaxesParser} from 'saxes';
export interface SafeXmlAttribute {readonly local:string;readonly uri:string;readonly value:string}
export interface SafeXmlElement {
 readonly local:string;readonly uri:string;readonly attributes:readonly SafeXmlAttribute[];
 readonly children:readonly (SafeXmlElement|string)[];
}
interface MutableElement {local:string;uri:string;attributes:SafeXmlAttribute[];children:(SafeXmlElement|string)[]}
const invalid=():never=>{throw new Error('IMPORT_XML_INVALID');};
/** Strict in-memory XML boundary. No DTD, resource resolver, filesystem or network. */
export function parseSafeXml(bytes:Uint8Array):SafeXmlElement{
 try{
  if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>16*1024*1024)return invalid();
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),stack:MutableElement[]=[];
  let root:SafeXmlElement|undefined,nodes=0,characters=0,segments=0;
  const parser=new SaxesParser({xmlns:true,position:false,fragment:false,defaultXMLVersion:'1.0'});
  parser.on('error',()=>invalid());parser.on('doctype',()=>invalid());parser.on('processinginstruction',()=>invalid());
  parser.on('xmldecl',decl=>{if(decl.version!=='1.0'||decl.encoding!==undefined&&decl.encoding.toLowerCase()!=='utf-8')return invalid();});
  const count=(length:number)=>{characters+=length;if(characters>5_000_000)return invalid();};
  parser.on('opentag',tag=>{
   if(++nodes>100_000||stack.length>=64||tag.local.length>1024||tag.uri.length>2048)return invalid();
   const attributes=Object.values(tag.attributes);if(attributes.length>256)return invalid();
   const checked=attributes.map(attribute=>{
    if(attribute.local.length>1024||attribute.uri.length>2048||attribute.value.length>10000)return invalid();count(attribute.value.length);
    return Object.freeze({local:attribute.local,uri:attribute.uri,value:attribute.value});
   });
   stack.push({local:tag.local,uri:tag.uri,attributes:checked,children:[]});
  });
  const append=(value:string)=>{
   if(!value.length)return;count(value.length);if(++segments>200_000)return invalid();
   const parent=stack.at(-1);if(parent)parent.children.push(value);else if(value.trim())return invalid();
  };
  parser.on('text',append);parser.on('cdata',append);
  parser.on('closetag',()=>{
   const element=stack.pop();if(!element)return invalid();Object.freeze(element.attributes);Object.freeze(element.children);Object.freeze(element);
   const parent=stack.at(-1);if(parent)parent.children.push(element);else{if(root)return invalid();root=element;}
  });
  parser.write(text).close();if(!root||stack.length)return invalid();return root;
 }catch{return invalid();}
}
export function xmlChildren(element:SafeXmlElement,local:string,uri:string):SafeXmlElement[]{
 return element.children.filter((child):child is SafeXmlElement=>typeof child!=='string'&&child.local===local&&child.uri===uri);
}
export function xmlAttribute(element:SafeXmlElement,local:string,uri=''):string|null{return element.attributes.find(attribute=>attribute.local===local&&attribute.uri===uri)?.value??null;}
export function xmlText(element:SafeXmlElement):string{
 const parts:string[]=[];const visit=(node:SafeXmlElement)=>{for(const child of node.children)if(typeof child==='string')parts.push(child);else visit(child);};
 visit(element);return parts.join('');
}
