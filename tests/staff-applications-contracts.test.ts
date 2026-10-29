import {expect,it} from 'vitest';
import {
  submitApplicationSchema,
  decideApplicationSchema,
  suspendApplicationSchema,
  applicationQuerySchema,
} from '@/lib/staff/applications-contracts';

const departmentId='6bd1b62e-8f8a-4b9f-8d1f-e35f3f2a5b34';
const requestId='e3490a61-8d27-4b60-b7d6-80bd75854138';
const validSubmit={applicantName:'  นางสาว ตัวอย่าง  ',staffCode:'  YRU-123  ',departmentId,requestId};

it('trims applicant claims and accepts only the frozen submit fields',()=>{
  expect(submitApplicationSchema.parse(validSubmit)).toEqual({
    applicantName:'นางสาว ตัวอย่าง',staffCode:'YRU-123',departmentId,requestId,
  });
});

it('rejects blank or overlong applicant claims, invalid identifiers and privilege or identity fields',()=>{
  for(const value of [
    {...validSubmit,applicantName:'  '},
    {...validSubmit,applicantName:'ก'.repeat(121)},
    {...validSubmit,staffCode:'  '},
    {...validSubmit,staffCode:'X'.repeat(65)},
    {...validSubmit,departmentId:'not-a-uuid'},
    {...validSubmit,requestId:'not-a-uuid'},
    {...validSubmit,role:'SUPER_ADMIN'},
    {...validSubmit,userId:requestId},
    {...validSubmit,lineSubject:'U'+'a'.repeat(32)},
  ]) expect(submitApplicationSchema.safeParse(value).success).toBe(false);
});

it('accepts approval only with an explicit final department and bounded optional reason',()=>{
  const command={decision:'APPROVE',departmentId,revision:0,requestId};
  expect(decideApplicationSchema.parse(command)).toEqual(command);
  expect(decideApplicationSchema.parse({...command,reason:'  ตรวจเอกสารแล้ว  '})).toEqual({...command,reason:'ตรวจเอกสารแล้ว'});
  expect(decideApplicationSchema.safeParse({...command,reason:'ก'.repeat(2001)}).success).toBe(false);
});

it('requires a reason for rejection and forbids a final department on rejection',()=>{
  const command={decision:'REJECT',reason:'  ข้อมูลไม่ครบ  ',revision:3,requestId};
  expect(decideApplicationSchema.parse(command)).toEqual({...command,reason:'ข้อมูลไม่ครบ'});
  for(const value of [
    {decision:'REJECT',revision:3,requestId},
    {...command,reason:'  '},
    {...command,reason:'ก'.repeat(2001)},
    {...command,departmentId},
  ]) expect(decideApplicationSchema.safeParse(value).success).toBe(false);
});

it('rejects invalid decisions, revisions, request ids and unrecognized authority fields',()=>{
  const base={decision:'APPROVE',departmentId,revision:0,requestId};
  for(const value of [
    {...base,decision:'SUSPEND'},
    {...base,revision:-1},
    {...base,revision:1.5},
    {...base,revision:2147483648},
    {...base,requestId:'bad'},
    {...base,reviewerId:requestId},
    {...base,role:'STAFF'},
  ]) expect(decideApplicationSchema.safeParse(value).success).toBe(false);
});

it('requires a bounded reason and valid revision/request id to suspend',()=>{
  const command={reason:'  ตรวจพบความเสี่ยง  ',revision:2147483647,requestId};
  expect(suspendApplicationSchema.parse(command)).toEqual({...command,reason:'ตรวจพบความเสี่ยง'});
  for(const value of [
    {...command,reason:'  '},
    {...command,reason:'ก'.repeat(2001)},
    {...command,revision:-1},
    {...command,revision:2147483648},
    {...command,revision:1.2},
    {...command,requestId:'bad'},
    {...command,departmentId},
    {...command,role:'SUPER_ADMIN'},
  ]) expect(suspendApplicationSchema.safeParse(value).success).toBe(false);
});

it('defaults application listing to page 1 and 20 rows and returns canonical numeric query values',()=>{
  expect(applicationQuerySchema.parse({})).toEqual({page:1,pageSize:20});
  expect(applicationQuerySchema.parse({status:'PENDING',page:'2',pageSize:'100'})).toEqual({status:'PENDING',page:2,pageSize:100});
  for(const status of ['PENDING','APPROVED','REJECTED','SUSPENDED']) {
    expect(applicationQuerySchema.parse({status})).toMatchObject({status,page:1,pageSize:20});
  }
});

it('rejects unknown statuses, arrays, extra query keys, and noncanonical or out-of-range pagination',()=>{
  for(const value of [
    {status:'ALL'},
    {status:['PENDING']},
    {page:['1']},
    {pageSize:['20']},
    {offset:'0'},
    {page:'0'},
    {page:'101'},
    {pageSize:'0'},
    {pageSize:'101'},
    {page:'01'},
    {page:'+1'},
    {page:'1.0'},
    {page:'1e0'},
    {page:' 1'},
    {page:''},
    {pageSize:'020'},
  ]) expect(applicationQuerySchema.safeParse(value).success).toBe(false);
});
