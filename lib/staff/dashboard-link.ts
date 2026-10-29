/** Links are built from deployment configuration and server-owned IDs, never LINE text. */
export function staffDashboardLink(ticketId?:string):string{
 try{const base=new URL(process.env.APP_BASE_URL??'');
  if(base.username||base.password||!(base.protocol==='https:'||base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))return '';
  const url=new URL('/inbox',base.origin);if(ticketId)url.searchParams.set('ticket',ticketId);return url.toString();
 }catch{return '';}
}
