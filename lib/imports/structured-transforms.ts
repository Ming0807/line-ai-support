import {StructuredMappingError,type ColumnBinding} from './structured-mapping-contract';
export {isStructuredTransformCompatible} from './structured-mapping-contract';

const invalid=():never=>{throw new StructuredMappingError('STRUCTURED_MAPPING_ROW_INVALID');};
function civil(value:string,buddhist=false,dmy=false):string {
 const match=(dmy?/^([0-9]{2})\/([0-9]{2})\/([0-9]{4})$/u:/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u).exec(value);
 if(!match||match[0]!==value)return invalid();
 const year=Number(match[dmy?3:1])-(buddhist?543:0),month=match[2],day=match[dmy?1:3];
 if(year<1800||year>2400)return invalid();const date=`${String(year).padStart(4,'0')}-${month}-${day}`;
 try{if(new Date(`${date}T00:00:00.000Z`).toISOString().slice(0,10)!==date)return invalid();}catch{return invalid();}return date;
}
function utc(value:string):string {
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u.test(value))return invalid();
 civil(value.slice(0,10));try{if(new Date(value).toISOString()!==value)return invalid();}catch{return invalid();}return value;
}
function plus07(value:string):string {
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$/u.test(value))return invalid();
 const local=utc(value.replace(' ','T')+'Z');return utc(new Date(new Date(local).getTime()-7*60*60*1000).toISOString());
}
export function transformStructuredCell(binding:ColumnBinding,value:string):string|number|null {
 if(typeof value!=='string'||!value.isWellFormed()||value.length>10_000)return invalid();
 if(!value.trim()){if(binding.blank==='NULL')return null;return invalid();}
 const transform=binding.transform;
 if(transform==='TEXT_V1')return value;
 if(transform==='INTEGER_V1'){const match=/^(?:0|[1-9][0-9]{0,8})$/u.exec(value);if(!match||match[0]!==value)return invalid();return Number(value);}
 if(transform==='DECIMAL_V1'){const match=/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.exec(value);if(!match||match[0]!==value)return invalid();return value;}
 if(transform==='DECIMAL_COMMA_V1'){
  const match=/^(?:(?:0|[1-9][0-9]*)|(?:[1-9][0-9]{0,2}(?:,[0-9]{3})+))(?:\.[0-9]+)?$/u.exec(value);
  if(!match||match[0]!==value)return invalid();return value.replaceAll(',','');
 }
 if(transform==='DATE_GREGORIAN_V1')return civil(value);
 if(transform==='DATE_BUDDHIST_V1')return civil(value,true);
 if(transform==='DATE_DMY_GREGORIAN_V1')return civil(value,false,true);
 if(transform==='DATE_DMY_BUDDHIST_V1')return civil(value,true,true);
 if(transform==='TIMESTAMP_UTC_V1')return utc(value);
 if(transform==='TIMESTAMP_PLUS07_V1')return plus07(value);
 if(transform==='DATE_GREGORIAN_PLUS07_MIDNIGHT_V1')return plus07(`${civil(value)} 00:00:00.000`);
 if(transform==='DATE_BUDDHIST_PLUS07_MIDNIGHT_V1')return plus07(`${civil(value,true)} 00:00:00.000`);
 return invalid();
}
