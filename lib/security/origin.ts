/** Next may normalize request.url to its internal hostname; browsers supply the external Host/Origin. */
export function isSameOrigin(request:Request):boolean {
 const origin=request.headers.get('origin'),host=request.headers.get('host');if(!origin||!host)return false;
 try{
  const parsed=new URL(origin),protocol=request.headers.get('x-forwarded-proto')??new URL(request.url).protocol.replace(':','');
  return ['http','https'].includes(protocol)&&parsed.origin===origin&&parsed.host===host&&parsed.protocol===`${protocol}:`;
 }catch{return false;}
}
