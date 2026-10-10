/** Acknowledgment covers complete source messages, never truncated previews or later arrivals. */
export function selectStaffCaseSnapshot(code:string,pending:{content:string;message_seq:string}[],cursor:string){
 const available=5000-`เคส ${code} · ข้อความจากผู้ใช้:\n`.length;
 const messages:{text:string}[]=[];let frames=0,readThrough=cursor;
 for(const row of pending){
  // Reserve one unit at each split so a surrogate pair cannot overflow the next frame.
  const needed=Math.max(1,Math.ceil(row.content.length/(available-1)));
  if(frames+needed>4){
   if(!messages.length)messages.push({text:row.content});
   break;
  }
  messages.push({text:row.content});frames+=needed;readThrough=String(row.message_seq);
 }
 return {messages,readThrough,hasMore:readThrough!==String(pending.at(-1)?.message_seq??cursor)};
}
