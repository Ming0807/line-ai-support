import {afterEach,expect,it,vi} from 'vitest';
import {deliverLine,type DeliveryInput,type LineMessage} from '../lib/line/delivery';
import {lineMessagesSchema,lineTextMessageSchema} from '../lib/line/message-schemas';

const token='fixture-line-token';
const recipient='U1234567890abcdef';
const retryKey='6f7d3f8c-36e6-4cf5-a0a7-c3d92f53f4b1';
const dashboardUri='https://help.yru.ac.th/inbox/tickets/00000000-0000-4000-8000-000000000001';
const textWithUri={type:'text',text:'Open the assigned case',quickReply:{items:[{type:'action',action:{
 type:'uri',label:'Open case',uri:dashboardUri,
}}]}};

function input(messages:unknown[]):DeliveryInput{
 return {channel:'STAFF',mode:'PUSH',recipientId:recipient,messages:messages as LineMessage[],retryKey,firstAttemptAt:null,
  replyDeadlineAt:null,attempts:0};
}

function fakeFetch(){
 const calls:Array<{url:string;init:RequestInit}>=[];
 const fetchImpl=(async(url:string|URL|Request,init?:RequestInit)=>{
  calls.push({url:String(url),init:init??{}});return new Response(null,{status:200});
 }) as typeof fetch;
 return {calls,fetchImpl};
}

afterEach(()=>vi.restoreAllMocks());

it('delivers a valid HTTPS Dashboard quick-reply URI unchanged',async()=>{
 const {calls,fetchImpl}=fakeFetch();
 const result=await deliverLine(input([textWithUri]),{accessToken:token,fetchImpl,now:()=>new Date('2026-10-29T00:00:00.000Z')});

 expect(result).toMatchObject({status:'SENT',mode:'PUSH',httpStatus:200});
 expect(calls).toHaveLength(1);
 expect(calls[0]!.url).toBe('https://api.line.me/v2/bot/message/push');
 expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({messages:[{quickReply:{items:[{
  action:{type:'uri',uri:dashboardUri},
 }]}}]});
});

it.each([
 ['HTTPS URI with username','https://staff@help.yru.ac.th/inbox'],
 ['HTTPS URI with password','https://staff:secret@help.yru.ac.th/inbox'],
 ['JavaScript scheme','javascript:alert(1)'],
 ['data scheme','data:text/html,hello'],
 ['telephone scheme','tel:+66000000000'],
 ['custom scheme','yru-dashboard://ticket/1'],
 ['non-local HTTP URI','http://help.yru.ac.th/inbox'],
 ['URI over the 1000 character limit',`https://help.yru.ac.th/${'a'.repeat(1000)}`],
] as const)('rejects unsafe %s values in the shared message schema',(_name,uri)=>{
 expect(lineTextMessageSchema.safeParse({...textWithUri,quickReply:{items:[{type:'action',action:{
  type:'uri',label:'Open case',uri,
 }}]}}).success).toBe(false);
});

it('retains strict postback actions and rejects unknown URI action fields',async()=>{
 const postback={type:'text',text:'Open the assigned case',quickReply:{items:[{type:'action',action:{
  type:'postback',label:'Accept',data:'yru:staff:accept:opaque',
 }}]}};
 expect(lineTextMessageSchema.safeParse(postback).success).toBe(true);
 expect(lineTextMessageSchema.safeParse({...textWithUri,quickReply:{items:[{type:'action',action:{
  type:'uri',label:'Open case',uri:dashboardUri,unexpected:true,
 }}]}}).success).toBe(false);

 const {calls,fetchImpl}=fakeFetch();
 const result=await deliverLine(input([postback]),{accessToken:token,fetchImpl,now:()=>new Date('2026-10-29T00:00:00.000Z')});
 expect(result).toMatchObject({status:'SENT',mode:'PUSH',httpStatus:200});
 expect(calls).toHaveLength(1);
 expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({messages:[postback]});
});

it('retains five-message and thirteen-action packet limits',()=>{
 expect(lineMessagesSchema.safeParse(Array.from({length:5},()=>textWithUri)).success).toBe(true);
 expect(lineMessagesSchema.safeParse(Array.from({length:6},()=>textWithUri)).success).toBe(false);
 const messageWithThirteenActions={...textWithUri,quickReply:{items:Array.from({length:13},(_,index)=>({type:'action',action:{
  type:'uri',label:`Open ${index}`,uri:dashboardUri,
 }}))}};
 const messageWithFourteenActions={...messageWithThirteenActions,quickReply:{items:[...messageWithThirteenActions.quickReply.items,
  {type:'action',action:{type:'uri',label:'Open 13',uri:dashboardUri}},
 ]}};
 expect(lineTextMessageSchema.safeParse(messageWithThirteenActions).success).toBe(true);
 expect(lineTextMessageSchema.safeParse(messageWithFourteenActions).success).toBe(false);
});
