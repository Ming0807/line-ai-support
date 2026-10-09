import {z} from 'zod';
import {copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';

export class PublicSearchQueryError extends Error {
 readonly code='PUBLIC_SEARCH_QUERY_INVALID' as const;
 constructor(){super('PUBLIC_SEARCH_QUERY_INVALID');this.name='PublicSearchQueryError';}
}

const topics={
 'YRU_INFORMATION:ACADEMIC_CALENDAR':{query:'มหาวิทยาลัยราชภัฏยะลา ปฏิทินวิชาการ',includeDomains:['acdservice.yru.ac.th','eduservice.yru.ac.th'],yearAllowed:true},
 'YRU_INFORMATION:CREDIT_TRANSFER':{query:'มหาวิทยาลัยราชภัฏยะลา เทียบโอนผลการเรียน',includeDomains:['eduservice.yru.ac.th','acdservice.yru.ac.th'],yearAllowed:true},
 'YRU_INFORMATION:TUITION_FEES':{query:'มหาวิทยาลัยราชภัฏยะลา ค่าธรรมเนียมการศึกษา',includeDomains:['eduservice.yru.ac.th','acdservice.yru.ac.th'],yearAllowed:true},
 'YRU_INFORMATION:REGISTRATION':{query:'มหาวิทยาลัยราชภัฏยะลา ลงทะเบียน',includeDomains:['eduservice.yru.ac.th','acdservice.yru.ac.th'],yearAllowed:true},
 'YRU_INFORMATION:WIFI_ACCESS':{query:'มหาวิทยาลัยราชภัฏยะลา YRU-WiFi คู่มือ',includeDomains:['nse.yru.ac.th'],yearAllowed:false},
 'YRU_INFORMATION:LIBRARY_SERVICES':{query:'มหาวิทยาลัยราชภัฏยะลา ห้องสมุด บริการ',includeDomains:['yru.ac.th'],yearAllowed:false},
 'YRU_INFORMATION:STUDENT_ACTIVITIES':{query:'มหาวิทยาลัยราชภัฏยะลา กิจกรรมนักศึกษา',includeDomains:['stddev.yru.ac.th'],yearAllowed:true},
 'YRU_INFORMATION:DORMITORY':{query:'มหาวิทยาลัยราชภัฏยะลา หอพัก ระเบียบ',includeDomains:['stddev.yru.ac.th'],yearAllowed:true},
 'GENERAL_PUBLIC:GENERAL_WIFI_HELP':{query:'Wi-Fi connection troubleshooting',includeDomains:[],yearAllowed:false},
 'GENERAL_PUBLIC:GENERAL_HTTP_500':{query:'HTTP 500 troubleshooting',includeDomains:[],yearAllowed:false},
 'GENERAL_PUBLIC:GENERAL_DEVICE_NETWORK':{query:'device network troubleshooting',includeDomains:[],yearAllowed:false},
} as const;

const purposeSchema=z.enum(['YRU_INFORMATION','GENERAL_PUBLIC']);
const topicSchema=z.enum([
 'ACADEMIC_CALENDAR','CREDIT_TRANSFER','TUITION_FEES','REGISTRATION','WIFI_ACCESS','LIBRARY_SERVICES','STUDENT_ACTIVITIES','DORMITORY',
 'GENERAL_WIFI_HELP','GENERAL_HTTP_500','GENERAL_DEVICE_NETWORK',
]);
const inputSchema=z.object({
 version:z.literal(1),
 purpose:purposeSchema,
 topic:topicSchema,
 academicYear:z.number().int().min(2400).max(3000).nullable(),
}).strict();

export type PublicSearchPurpose=z.infer<typeof purposeSchema>;
export type PublicSearchTopic=z.infer<typeof topicSchema>;
export type PublicSearchQuery=Readonly<{
 version:1;
 purpose:PublicSearchPurpose;
 topic:PublicSearchTopic;
 academicYear:number|null;
 query:string;
 includeDomains:readonly string[];
}>;

/** Build a minimized public query from the closed C2-Q vocabulary only. */
export function buildPublicSearchQuery(input:unknown):PublicSearchQuery {
 try{
  const copied=copyStructuredJson(input,4096,64);
  const value=inputSchema.parse(copied);
  const topic=topics[`${value.purpose}:${value.topic}` as keyof typeof topics];
  if(!topic||!topic.yearAllowed&&value.academicYear!==null)throw new PublicSearchQueryError();
  const query=value.academicYear===null?topic.query:`${topic.query} ปีการศึกษา ${value.academicYear}`;
  return freezeStructuredData({
   version:1 as const,
   purpose:value.purpose,
   topic:value.topic,
   academicYear:value.academicYear,
   query,
   includeDomains:[...topic.includeDomains],
  });
 }catch{
  throw new PublicSearchQueryError();
 }
}
