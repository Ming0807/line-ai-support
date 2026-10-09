import {expect,it} from 'vitest';
import {buildPublicSearchQuery} from '../lib/knowledge/public-search-query';

const cases=[
 {purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR',query:'มหาวิทยาลัยราชภัฏยะลา ปฏิทินวิชาการ',includeDomains:['acdservice.yru.ac.th','eduservice.yru.ac.th'],yearAllowed:true},
 {purpose:'YRU_INFORMATION',topic:'CREDIT_TRANSFER',query:'มหาวิทยาลัยราชภัฏยะลา เทียบโอนผลการเรียน',includeDomains:['eduservice.yru.ac.th','acdservice.yru.ac.th'],yearAllowed:true},
 {purpose:'YRU_INFORMATION',topic:'TUITION_FEES',query:'มหาวิทยาลัยราชภัฏยะลา ค่าธรรมเนียมการศึกษา',includeDomains:['eduservice.yru.ac.th','acdservice.yru.ac.th'],yearAllowed:true},
 {purpose:'YRU_INFORMATION',topic:'REGISTRATION',query:'มหาวิทยาลัยราชภัฏยะลา ลงทะเบียน',includeDomains:['eduservice.yru.ac.th','acdservice.yru.ac.th'],yearAllowed:true},
 {purpose:'YRU_INFORMATION',topic:'WIFI_ACCESS',query:'มหาวิทยาลัยราชภัฏยะลา YRU-WiFi คู่มือ',includeDomains:['nse.yru.ac.th'],yearAllowed:false},
 {purpose:'YRU_INFORMATION',topic:'LIBRARY_SERVICES',query:'มหาวิทยาลัยราชภัฏยะลา ห้องสมุด บริการ',includeDomains:['yru.ac.th'],yearAllowed:false},
 {purpose:'YRU_INFORMATION',topic:'STUDENT_ACTIVITIES',query:'มหาวิทยาลัยราชภัฏยะลา กิจกรรมนักศึกษา',includeDomains:['stddev.yru.ac.th'],yearAllowed:true},
 {purpose:'YRU_INFORMATION',topic:'DORMITORY',query:'มหาวิทยาลัยราชภัฏยะลา หอพัก ระเบียบ',includeDomains:['stddev.yru.ac.th'],yearAllowed:true},
 {purpose:'GENERAL_PUBLIC',topic:'GENERAL_WIFI_HELP',query:'Wi-Fi connection troubleshooting',includeDomains:[],yearAllowed:false},
 {purpose:'GENERAL_PUBLIC',topic:'GENERAL_HTTP_500',query:'HTTP 500 troubleshooting',includeDomains:[],yearAllowed:false},
 {purpose:'GENERAL_PUBLIC',topic:'GENERAL_DEVICE_NETWORK',query:'device network troubleshooting',includeDomains:[],yearAllowed:false},
] as const;

function expectInvalid(input:unknown){
 let error:unknown;
 try{buildPublicSearchQuery(input);}catch(caught){error=caught;}
 expect(error).toBeInstanceOf(Error);
 expect((error as Error).message).toBe('PUBLIC_SEARCH_QUERY_INVALID');
 expect(String(error)).not.toMatch(/private|attacker|prototype value|model-supplied-query|https?:/iu);
}

it('builds only the frozen query and domain values for every registered purpose/topic pair',()=>{
 for(const entry of cases){
  const academicYear=entry.yearAllowed?2569:null;
  const result=buildPublicSearchQuery({version:1,purpose:entry.purpose,topic:entry.topic,academicYear});
  expect(result).toEqual({
   version:1,
   purpose:entry.purpose,
   topic:entry.topic,
   academicYear,
   query:entry.query+(entry.yearAllowed?' ปีการศึกษา 2569':''),
   includeDomains:entry.includeDomains,
  });
 }
});

it('adds an allowed year only as the fixed Thai suffix and requires null where years are forbidden',()=>{
 const academic=buildPublicSearchQuery({version:1,purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR',academicYear:2570});
 expect(academic.query).toBe('มหาวิทยาลัยราชภัฏยะลา ปฏิทินวิชาการ ปีการศึกษา 2570');
 expectInvalid({version:1,purpose:'YRU_INFORMATION',topic:'WIFI_ACCESS',academicYear:2569});
 expectInvalid({version:1,purpose:'GENERAL_PUBLIC',topic:'GENERAL_WIFI_HELP',academicYear:2569});
});

it('rejects raw, case-shifted, URL, model-controlled, and unknown query fields',()=>{
 const base={version:1,purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR',academicYear:null};
 for(const input of [
  {...base,topic:'ลงทะเบียน 2569'},
  {...base,topic:'academic_calendar'},
  {...base,url:'https://attacker.example/search'},
  {...base,query:'มหาวิทยาลัย ราชภัฏยะลา'},
  {...base,domains:['attacker.example']},
  {...base,model:'model-supplied-query'},
  {...base,extra:true},
 ])expectInvalid(input);
});

it('rejects invalid purposes and topics that cross the frozen purpose boundary',()=>{
 for(const input of [
  {version:1,purpose:'GENERAL_PUBLIC',topic:'ACADEMIC_CALENDAR',academicYear:null},
  {version:1,purpose:'YRU_INFORMATION',topic:'GENERAL_WIFI_HELP',academicYear:null},
  {version:1,purpose:'general_public',topic:'GENERAL_WIFI_HELP',academicYear:null},
  {version:1,purpose:'OTHER',topic:'ACADEMIC_CALENDAR',academicYear:null},
 ])expectInvalid(input);
});

it('requires a strict supported integer year or null',()=>{
 for(const academicYear of [2399,3001,2400.5,'2569',true,{},undefined]){
  expectInvalid({version:1,purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR',academicYear});
 }
 expect(buildPublicSearchQuery({version:1,purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR',academicYear:2400}).query)
  .toBe('มหาวิทยาลัยราชภัฏยะลา ปฏิทินวิชาการ ปีการศึกษา 2400');
 expect(buildPublicSearchQuery({version:1,purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR',academicYear:3000}).query)
  .toBe('มหาวิทยาลัยราชภัฏยะลา ปฏิทินวิชาการ ปีการศึกษา 3000');
});

it('rejects inherited and accessor properties without evaluating caller getters',()=>{
 let getterCalls=0;
 const inherited=Object.assign(Object.create({private:'prototype value'}),{version:1,purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR',academicYear:null});
 const accessor={version:1,purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR'} as Record<string,unknown>;
 Object.defineProperty(accessor,'academicYear',{enumerable:true,get(){getterCalls++;return null;}});
 expectInvalid(inherited);
 expectInvalid(accessor);
 expect(getterCalls).toBe(0);
});

it('rejects non-JSON objects and maps proxy inspection failures to the fixed error',()=>{
 const valid={version:1,purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR',academicYear:null};
 const proxied=new Proxy(valid,{ownKeys(){throw new Error('private proxy detail');}});
 const cyclic:Record<string,unknown>={...valid};cyclic.extra=cyclic;
 for(const input of [
  proxied,
  cyclic,
  {...valid,academicYear:BigInt(1)},
  {...valid,academicYear:Symbol('private')},
  {...valid,academicYear:new Date('2026-01-01T00:00:00.000Z')},
  {...valid,academicYear:NaN},
 ])expectInvalid(input);
});

it('rejects JSON input beyond either the byte or node budget with the same redacted error',()=>{
 const valid={version:1,purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR',academicYear:null};
 expectInvalid({...valid,extra:'x'.repeat(5000)});
 const tooManyNodes:Record<string,unknown>={...valid};
 for(let index=0;index<61;index++)tooManyNodes[`unknown${index}`]=index;
 expectInvalid(tooManyNodes);
});

it('returns a detached deeply frozen result and does not mutate the input',()=>{
 const input={version:1 as const,purpose:'YRU_INFORMATION' as const,topic:'ACADEMIC_CALENDAR' as const,academicYear:2569};
 const before={...input};
 const result=buildPublicSearchQuery(input);
 expect(result).not.toBe(input);
 expect(input).toEqual(before);
 expect(Object.isFrozen(result)).toBe(true);
 expect(Object.isFrozen(result.includeDomains)).toBe(true);
 input.academicYear=2570;
 expect(result.academicYear).toBe(2569);
 expect(result.query).toBe('มหาวิทยาลัยราชภัฏยะลา ปฏิทินวิชาการ ปีการศึกษา 2569');
 expect(()=>{(result.includeDomains as unknown as string[]).push('attacker.example');}).toThrow();
});
