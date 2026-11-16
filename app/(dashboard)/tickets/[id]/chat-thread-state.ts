import type {ChatMessage,ChatNote} from '@/types/inbox';

export type ThreadSpan = {lo:number;hi:number};
export type ThreadWindow = {messages:ChatMessage[];hasMore:boolean;nextBefore:number|null};
export type IncomingWindow = {messages:ChatMessage[];hasMore:boolean;nextBefore:number|null};
export type ThreadMergeSource = 'refresh'|'history'|'catchup';
export type ThreadMergeResult = ThreadWindow & {
  /** Sequence that must be fetched AGAINST (beforeSequence=<value>) to fill the first un-covered range. */
  firstCatchUpBefore:number|null;
  /** Contiguous server ranges currently known to be loaded (dedupe/sort/adjacency-merged). */
  spans:ThreadSpan[];
  /** Sequence ranges proven by the server to contain no messages of this ticket. */
  empties:ThreadSpan[];
};

const spanOf = (messages:readonly ChatMessage[]):ThreadSpan[]=>{
  if(!messages.length)return[];
  let lo=messages[0].sequence;
  let hi=lo;
  for(const message of messages){
    if(message.sequence<lo)lo=message.sequence;
    if(message.sequence>hi)hi=message.sequence;
  }
  return [{lo,hi}];
};

/** Server windows are contiguous; only junctions between spans can hide holes, and this recomputes after every merge. */
export function firstCatchUpBeforeSpans(spans:readonly ThreadSpan[],empties:readonly ThreadSpan[]=[]):number|null{
  const sorted=[...spans].sort((a,b)=>a.lo-b.lo);
  for(let index=1;index<sorted.length;index+=1){
    const floor=sorted[index-1],ceiling=sorted[index];
    const hole={lo:floor.hi+1,hi:ceiling.lo-1};
    if(hole.lo<=hole.hi&&!empties.some(empty=>empty.lo<=hole.lo&&empty.hi>=hole.hi))return ceiling.lo;
  }
  return null;
}

const pointIn=(spans:readonly ThreadSpan[],point:number|null):boolean=>point!==null&&spans.some(span=>point>=span.lo&&point<=span.hi);

export function mergeThreadWindow(
  previous:{messages:ChatMessage[];hasMore:boolean;nextBefore:number|null;spans?:ThreadSpan[];empties?:ThreadSpan[]},
  incoming:IncomingWindow,
  source:ThreadMergeSource,
  options?:{beforeSequence?:number},
):ThreadMergeResult{
  // S13/D5: a history/catch-up window is OLDER material — when it repeats a
  // message id, the newer known copy (current delivery badge, edited content)
  // must win. Only a refresh carries newer authority and overwrites by id.
  const byId=new Map<string,ChatMessage>();
  if(source==='refresh'){
    for(const message of[...previous.messages,...incoming.messages])byId.set(message.id,message);
  }else{
    for(const message of[...incoming.messages,...previous.messages])byId.set(message.id,message);
  }
  const messages=[...byId.values()].sort((a,b)=>a.sequence-b.sequence);
  const previousSpans=previous.spans??spanOf(previous.messages);
  const incomingSpans=spanOf(incoming.messages);
  const spans=mergeSpans([...previousSpans,...incomingSpans]);
  const empties:ThreadSpan[]=[...(previous.empties??[])];
  // The oldest loaded sequence decides which side still owns the "more history below" truth.
  const oldest=spans.length?spans[0].lo:null;
  let hasMore=false;
  if(oldest!==null){
    const previousSupplies=pointIn(previousSpans,oldest);
    const incomingSupplies=pointIn(incomingSpans,oldest);
    if(previousSupplies&&incomingSupplies)hasMore=previous.hasMore&&incoming.hasMore;
    else if(previousSupplies){
      // An older-history probe returning [] with hasMore:false reaches the true start.
      hasMore=source==='history'&&!incoming.messages.length&&!incoming.hasMore?false:previous.hasMore;
    }else hasMore=incoming.hasMore;
  }
  if(source==='history'){
    const cursor=options?.beforeSequence??previous.nextBefore??undefined;
    if(cursor!==undefined){
      if(incoming.messages.length===0){
        if(!incoming.hasMore&&cursor-1>=1)empties.push({lo:1,hi:cursor-1});
      }else{
        const highest=incomingSpans[0].hi;
        if(highest+1<=cursor-1)empties.push({lo:highest+1,hi:cursor-1});
      }
    }
  }
  // (a) hasMore:false proves no messages exist before the oldest loaded message.
  if(!hasMore&&oldest!==null&&oldest>1){
    empties.push({lo:1,hi:oldest-1});
  }
  const mergedEmpties=mergeSpans(empties);
  const nextBefore=hasMore?oldest:null;
  return {messages,hasMore,nextBefore,spans,empties:mergedEmpties,firstCatchUpBefore:firstCatchUpBeforeSpans(spans,mergedEmpties)};
}

function mergeSpans(input:ThreadSpan[]):ThreadSpan[]{
  const sorted=[...input].sort((a,b)=>a.lo-b.lo);
  const merged:ThreadSpan[]=[];
  for(const span of sorted){
    const last=merged[merged.length-1];
    if(last&&span.lo<=last.hi+1)last.hi=Math.max(last.hi,span.hi);
    else merged.push({...span});
  }
  return merged;
}

export type PendingWriteBody=Record<string,string|number>;
export type PendingWrite={
  actorId:string;ticketId:string;kind:'reply'|'note';endpoint:string;text:string;
  body:PendingWriteBody;startedAt:number;
};

function newRequestId():string{
  const cryptoApi=globalThis.crypto;
  if(typeof cryptoApi?.randomUUID==='function')return cryptoApi.randomUUID();
  throw new Error('REQUEST_ID_UNAVAILABLE');
}

/** The old unknown outcome is immutable: a poll, a new revision, or an edited draft never changes its body. */
export function pendingWriteDecision(
  previous:PendingWrite|undefined,
  next:{actorId:string;ticketId:string;kind:'reply'|'note';endpoint:string;text:string;body:PendingWriteBody},
):{reuse:boolean;write:PendingWrite}{
  if(previous)return{reuse:true,write:previous};
  if(next.body&&Object.hasOwn(next.body,'requestId')){
    const pending:PendingWrite={...next,startedAt:Date.now(),body:{...next.body}};
    return{reuse:false,write:pending};
  }
  const pending:PendingWrite={...next,startedAt:Date.now(),body:{...next.body,requestId:newRequestId()}};
  return{reuse:false,write:pending};
}

export type AttemptOutcome='committed'|'uncertain'|'reject-clear';

/** Delivery of the outcome classification for composer writes (post/read/note path included). */
export function writeAttemptOutcome(status:number|'network',responseKind:'parsed'|'invalid-json'|'no-json'):AttemptOutcome{
  if(status==='network')return'uncertain';
  if(status<400){
    return responseKind==='parsed'?'committed':'uncertain';
  }
  if(status>=500)return'uncertain';
  return'reject-clear';
}

/** Confirmation of the old request must not destroy a NEWER draft the user typed meanwhile. */
export function composeAfterSuccess(pending:PendingWrite,currentDraft:string):{clearComposer:boolean}{
  return{clearComposer:currentDraft.trim()!==''&&currentDraft.trim()===pending.text.trim()};
}

export type TicketActionResultView={id:string;status:(typeof ticketStatusValues)[number];revision:number};

/**
 * D3/D9 strict success DTO: exact ticket id, a known ticket-status enum value and an
 * integer revision. Anything else (empty object, wrong ticket, unknown status) keeps
 * the outcome unknown — a 200 alone must never commit.
 */
export function parseReplyResult(payload:unknown,ticketId:string):TicketActionResultView|null{
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
  const record=payload as Record<string,unknown>;
  if(typeof record.id!=='string'||record.id!==ticketId)return null;
  if(typeof record.status!=='string'||!(ticketStatusValues as readonly string[]).includes(record.status))return null;
  if(typeof record.revision!=='number'||!Number.isInteger(record.revision)||record.revision<0)return null;
  return{id:record.id,status:record.status as TicketActionResultView['status'],revision:record.revision};
}

/**
 * D9 note DTO: a non-empty id string (fixtures use synthetic ids such as note-9 — no
 * uuid requirement for notes) and a parsable creation timestamp. The text/staff fields
 * fall back to composer-side defaults when the server omits them.
 */
export function parseChatNote(payload:unknown):ChatNote|null{
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
  const record=payload as Record<string,unknown>;
  if(typeof record.id!=='string'||record.id.trim()==='')return null;
  if(typeof record.createdAt!=='string'||Number.isNaN(new Date(record.createdAt).getTime()))return null;
  return{
    id:record.id,
    text:typeof record.text==='string'?record.text:'',
    staffName:typeof record.staffName==='string'?record.staffName:'',
    createdAt:record.createdAt,
  };
}

/** Serial gate for the list request path (effect search/filter page, invalidation, manual refresh, post-submit aims). */
export class ListRequestGate{
  private current=0;
  begin():number{this.current+=1;return this.current;}
  accepts(token:number):boolean{return token===this.current;}
}

const inboxViews=['all','mine','unassigned','unread','waiting_staff','waiting_user'] as const;
export type InboxView=(typeof inboxViews)[number];
export const ticketStatusValues=['NEW','AI_HANDLING','WAITING_STAFF','STAFF_HANDLING','WAITING_USER','RESOLVED','CLOSED','CANCELLED'] as const;
export const priorityValues=['LOW','MEDIUM','HIGH','CRITICAL'] as const;
export const sensitivityValues=['GENERAL','SENSITIVE','RESTRICTED'] as const;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ticket ids are uuids: a malformed deep-link id must never reach a fetch. */
export function isTicketId(value:string):boolean{return uuidPattern.test(value);}
const categoryPattern=/^[A-Z][A-Z0-9_:-]{0,99}$/;
const datePattern=/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export type InboxListState={
  view:InboxView;page:number;pageSize:number;
  q?:string;category?:string;department?:string;status?:string;
  priority?:string;assignee?:string;sensitivity?:string;from?:string;to?:string;
};

export type RawSearchParams=Record<string,string|string[]|undefined>;

function firstValue(params:RawSearchParams,key:string):string|null{
  const value=params[key];
  if(typeof value==='string')return value;
  if(Array.isArray(value))return typeof value[0]==='string'?value[0]:null;
  return null;
}

const CONTROL_CHARACTERS=/\p{Cc}/gu;

/** Keys this page understands: the list state keys plus the selection deep-link handled by server/client elsewhere. */
const listStateKeys=['view','q','category','department','status','priority','assignee','sensitivity','from','to','page','pageSize'] as const;
const handledElsewhereKeys=['ticket'] as const;

/** `view=mine&view=mine` collapses to one accepted value; conflicting repeats are dropped per key, never silently-firsted. */
function normalizeRawDuplicates(params:RawSearchParams):{record:RawSearchParams;conflicts:string[]}{
  const record:RawSearchParams={};
  const conflicts:string[]=[];
  for(const[key,value]of Object.entries(params)){
    if(Array.isArray(value)){
      const first=value[0];
      const identical=value.every(item=>item===first);
      if(first!==undefined&&identical)record[key]=first;
      else{conflicts.push(key);record[key]=undefined;}
    }else record[key]=value;
  }
  return{record,conflicts};
}

/** The `ticket` selection deep-link is handled by the inbox mount: only strict uuids pass; anything else is flagged for the dropped-param note. */
export function ticketSelectionFromURL(params:RawSearchParams):{id:string|null;malformed:boolean}{
  const raw=params.ticket;
  if(raw===undefined||raw===null)return{id:null,malformed:false};
  const value=Array.isArray(raw)?raw[0]:raw;
  if(typeof value!=='string'||!isTicketId(value))return{id:null,malformed:true};
  return{id:value,malformed:false};
}

/** Deep-link/bad-query recovery: known keys are validated, unknown or malformed ones are dropped, never forwarded. */
export function inboxListStateFromURL(params:RawSearchParams):{state:InboxListState;dropped:string[]}{
  const dropped:string[]=[];
  for(const key of Object.keys(params)){
    if(!((listStateKeys as readonly string[]).includes(key)||(handledElsewhereKeys as readonly string[]).includes(key)))dropped.push(key);
  }
  const normalized=normalizeRawDuplicates(params);
  for(const key of normalized.conflicts)dropped.push(key);
  const source:RawSearchParams=normalized.record;
  const state:InboxListState={view:'all',page:1,pageSize:50};

  const view=firstValue(source,'view');
  if(view===null||view===''){if(view!==null)dropped.push('view');}
  else if((inboxViews as readonly string[]).includes(view))state.view=view as InboxView;
  else dropped.push('view');

  const q=firstValue(source,'q');
  if(q!==null){
    const cleaned=q.replace(CONTROL_CHARACTERS,'').trim();
    if(cleaned)state.q=cleaned;else dropped.push('q');
  }

  const category=firstValue(source,'category');
  if(category!==null){if(categoryPattern.test(category))state.category=category;else dropped.push('category');}

  for(const key of['department','assignee'] as const){
    const value=firstValue(source,key);
    if(value!==null){if(uuidPattern.test(value)){(state as Record<string,unknown>)[key]=value;}else dropped.push(key);}
  }

  const status=firstValue(source,'status');
  if(status!==null){if((ticketStatusValues as readonly string[]).includes(status))state.status=status;else dropped.push('status');}
  const priority=firstValue(source,'priority');
  if(priority!==null){if((priorityValues as readonly string[]).includes(priority))state.priority=priority;else dropped.push('priority');}
  const sensitivity=firstValue(source,'sensitivity');
  if(sensitivity!==null){if((sensitivityValues as readonly string[]).includes(sensitivity))state.sensitivity=sensitivity;else dropped.push('sensitivity');}

  for(const key of['from','to'] as const){
    const value=firstValue(source,key);
    if(value!==null){
      if(datePattern.test(value)&&Number.isFinite(new Date(`${value}T00:00:00+07:00`).getTime()))state[key]=value;
      else dropped.push(key);
    }
  }
  if(state.from&&state.to&&state.from>state.to){dropped.push('from');dropped.push('to');delete state.from;delete state.to;}

  const page=firstValue(source,'page');
  if(page!==null){
    const parsed=Number(page);
    if(Number.isInteger(parsed)&&parsed>=1&&parsed<=10000)state.page=parsed;else dropped.push('page');
  }
  const pageSize=firstValue(source,'pageSize');
  if(pageSize!==null){
    const parsed=Number(pageSize);
    if(Number.isInteger(parsed)&&parsed>=1&&parsed<=100)state.pageSize=parsed;else dropped.push('pageSize');
  }

  return{state,dropped};
}

/** Builds exactly the accepted backend query keys; nothing unknown is invented here. */
export function buildInboxListParams(state:InboxListState):URLSearchParams{
  const params=new URLSearchParams();
  params.set('view',state.view);
  params.set('page',String(state.page));
  params.set('pageSize',String(state.pageSize));
  if(state.q)params.set('q',state.q);
  if(state.category)params.set('category',state.category);
  if(state.department)params.set('department',state.department);
  if(state.status)params.set('status',state.status);
  if(state.priority)params.set('priority',state.priority);
  if(state.assignee)params.set('assignee',state.assignee);
  if(state.sensitivity)params.set('sensitivity',state.sensitivity);
  if(state.from)params.set('from',state.from);
  if(state.to)params.set('to',state.to);
  return params;
}

/** Canonical shareable URL: filters in schema order ending with page; pageSize stays out (server default applies). */
export function inboxListUrl(state:InboxListState):string{
  const params=new URLSearchParams();
  params.set('view',state.view);
  if(state.q)params.set('q',state.q);
  if(state.category)params.set('category',state.category);
  if(state.department)params.set('department',state.department);
  if(state.status)params.set('status',state.status);
  if(state.priority)params.set('priority',state.priority);
  if(state.assignee)params.set('assignee',state.assignee);
  if(state.sensitivity)params.set('sensitivity',state.sensitivity);
  if(state.from)params.set('from',state.from);
  if(state.to)params.set('to',state.to);
  params.set('page',String(state.page));
  const query=params.toString();
  return query?`/inbox?${query}`:'/inbox';
}

export type ListPagination={page:number;pageSize:number;total:number;totalPages:number;hasNext:boolean;hasPrevious:boolean};
export type ListCountOutcome=
  |{kind:'total';text:string}
  |{kind:'unknown';text:string}
  |{kind:'empty';text:string}
  |{kind:'out-of-range';text:string};

/** Missing server pagination is unknown, zero-page-1 is empty, a zero page beyond 1 is out of range: distinct states. */
export function paginationLabel(pagination:ListPagination|undefined,page:number):ListCountOutcome{
  if(!pagination)return{kind:'unknown',text:'จำนวนรายการ: ไม่ทราบ'};
  if(pagination.total===0){
    return page>1
      ?{kind:'out-of-range',text:'หน้าที่ระบุไม่มีรายการ · กลับไปหน้าแรก'}
      :{kind:'empty',text:'ไม่มีบทสนทนาตรงตัวกรอง'};
  }
  // S07: a nonzero total on a page past totalPages is STILL out of range — repeating
  // the raw total would look like an ordinary result and hide the recovery action.
  if(page>pagination.totalPages){
    return{kind:'out-of-range',text:'หน้าที่ระบุไม่มีรายการ · กลับไปหน้าแรก'};
  }
  return{kind:'total',text:`${pagination.total} รายการ`};
}

export type RealtimePhase='connecting'|'live'|'polling';
export function realtimePhaseMapper(status:string):RealtimePhase{
  if(status==='SUBSCRIBED')return'live';
  if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED')return'polling';
  return'connecting';
}

/** Read cursors are monotone even when a slow server response with a smaller value lands last. */
export function acknowledgeCursor(current:number,candidate:number):number{
  return Math.max(current,candidate);
}

/**
 * RX4 read-ack contiguity: the ack target may only advance to the contiguous
 * sequence frontier the workspace has PROVEN loaded. `spans` are the known
 * coverage windows; the walk starts at the acknowledged cursor and stops at
 * the first missing sequence. A gap (the rendered tail may sit behind an
 * unloaded earlier window) means the frontier holds at the last proven
 * sequence — the ack of the unloaded read would be a false claim.
 */
export type ContiguousReadTargetOptions = {
  empties?: readonly ThreadSpan[];
  hasMore?: boolean;
};

export function contiguousReadTarget(
  cursor: number,
  spans: readonly ThreadSpan[],
  emptiesOrOptions?: readonly ThreadSpan[] | ContiguousReadTargetOptions,
): number {
  const options: ContiguousReadTargetOptions = Array.isArray(emptiesOrOptions)
    ? { empties: emptiesOrOptions }
    : (emptiesOrOptions && !('length' in emptiesOrOptions) ? emptiesOrOptions : {});
  const sorted = mergeSpans([...spans]);
  const provenEmpties: ThreadSpan[] = [...(options.empties ?? [])];
  if (options.hasMore === false && sorted.length > 0 && sorted[0].lo > 1) {
    provenEmpties.push({ lo: 1, hi: sorted[0].lo - 1 });
  }
  const mergedEmpties = mergeSpans(provenEmpties);
  let target = cursor;
  for (const span of sorted) {
    if (span.hi <= target) continue;
    const holeLo = target + 1;
    const holeHi = span.lo - 1;
    if (holeLo <= holeHi) {
      const covered = mergedEmpties.some(empty => empty.lo <= holeLo && empty.hi >= holeHi);
      if (!covered) break;
    }
    target = span.hi;
  }
  return target;
}

export type CatchUpOutcome={
  spans:ThreadSpan[];
  /** Sequence ranges proven empty by the fetched window itself (anything between its newest point and the cursor). */
  empties:ThreadSpan[];
  firstCatchUpBefore:number|null;
};

/**
 * Bounded catch-up decision: one fetched window both merges coverage and proves absence in
 * [higherThanFetched..cursor-1] — a latest-N window below the cursor cannot have skipped those sequences.
 */
export function catchUpAfterFetch(
  coverage:{spans:readonly ThreadSpan[];empties:readonly ThreadSpan[]},
  fetched:{cursor:number;window:IncomingWindow},
):CatchUpOutcome{
  const empties=[...coverage.empties];
  if(fetched.window.messages.length===0){
    if(fetched.cursor-1>=1)empties.push({lo:1,hi:fetched.cursor-1});
  }else{
    const highest=Math.max(...fetched.window.messages.map(message=>message.sequence));
    if(highest+1<=fetched.cursor-1)empties.push({lo:highest+1,hi:fetched.cursor-1});
  }
  const merged=mergeThreadWindow({messages:[],hasMore:false,nextBefore:null,spans:[...coverage.spans]},fetched.window,'catchup');
  const mergedEmpties=mergeSpans(empties);
  return{spans:merged.spans,empties:mergedEmpties,firstCatchUpBefore:firstCatchUpBeforeSpans(merged.spans,mergedEmpties)};
}

/** Framework-independent bridge between URLSearchParams and the raw search-param record used by the state validator. */
export function rawFromURLSearchParams(searchParams:URLSearchParams):RawSearchParams{
  const record:Record<string,string|string[]|undefined>={};
  for(const key of new Set(searchParams.keys())){
    const values=searchParams.getAll(key);
    record[key]=values.length===1?values[0]:values;
  }
  return record;
}
