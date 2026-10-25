import {structuredAnswerSchema,validateStructuredEvidenceList} from './structured-citations';
import {validateStructuredPayload} from './structured-payload';

/** Input must already be authorized and name-resolved; this helper grants neither. */
export function buildServiceDiscoveryOutput(available:unknown){
 const rows=validateStructuredEvidenceList(available);
 if(rows.length>5||rows.some(row=>row.dataset!=='university_services'))throw new Error('SERVICE_DISCOVERY_INVALID');
 const services=rows.map(row=>validateStructuredPayload('university_services',row.payload));
 if(new Set(services.map(service=>service.name)).size!==1)throw new Error('SERVICE_DISCOVERY_INVALID');
 const notice=rows.length>1
  ?'พบข้อมูลบริการชื่อเดียวกันหลายรายการ รายละเอียดอาจต่างกันตามเงื่อนไขของแต่ละแหล่ง จึงแสดงทั้งหมดโดยยังไม่เลือกว่ารายการใดใช้แทนกันได้ครับ\n\n'
  :'ข้อมูลบริการตามเอกสารที่ผ่านการตรวจทาน:\n\n';
 const answer=notice+services.map((service,index)=>`${index+1}. ${service.name}`+
  (service.description===null?'':`\nรายละเอียดและเงื่อนไขจากเอกสาร: ${service.description}`)+
  `\nสถานที่: ${service.location??'เอกสารไม่ระบุ'}`+
  `\nเวลาทำการ: ${service.opening_hours??'เอกสารไม่ระบุ'}`+
  (service.phone===null?'':`\nโทรศัพท์: ${service.phone}`)+
  (service.email===null?'':`\nอีเมล: ${service.email}`)).join('\n\n');
 // Validate the complete answer; never discard a qualification or clip a row to fit.
 return structuredAnswerSchema.parse({answer,citationRowIds:rows.map(row=>row.rowId)});
}
