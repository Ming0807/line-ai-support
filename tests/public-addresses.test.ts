import {beforeEach,describe,expect,it,vi} from 'vitest';

const dns=vi.hoisted(()=>({
 Resolver:vi.fn(),
 resolver:{resolve4:vi.fn(),resolve6:vi.fn(),cancel:vi.fn()},
}));
vi.mock('node:dns/promises',()=>({Resolver:dns.Resolver}));

import {AIProviderError} from '../lib/ai/types';
import {isPublicAddress,resolvePublicAddresses} from '../lib/ai/public-addresses';

const answer4=(address:string)=>({address,family:4 as const});
const answer6=(address:string)=>({address,family:6 as const});
const dnsError=(code:string)=>Object.assign(new Error('private resolver detail'),{code});

beforeEach(()=>{
 vi.clearAllMocks();
 dns.resolver.resolve4.mockResolvedValue([]);
 dns.resolver.resolve6.mockRejectedValue(dnsError('ENODATA'));
 dns.Resolver.mockImplementation(function ResolverMock(){return dns.resolver as never;});
});

describe('isPublicAddress',()=>{
 it.each(['8.8.8.8','1.1.1.1','93.184.216.34'])( 'accepts public IPv4 %s',address=>{
  expect(isPublicAddress(answer4(address))).toBe(true);
 });

 it.each([
  '0.1.2.3','10.1.2.3','100.64.0.1','100.127.255.254','127.0.0.1','169.254.1.1','172.16.0.1','172.31.255.255',
  '192.0.0.1','192.0.2.1','192.31.196.1','192.52.193.1','192.88.99.1','192.168.1.1','192.175.48.1',
  '198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','240.0.0.1',
 ])('rejects non-public IPv4 %s',address=>expect(isPublicAddress(answer4(address))).toBe(false));

 it.each(['2606:4700:4700::1111','2001:4860:4860::8888'])( 'accepts public IPv6 %s',address=>{
  expect(isPublicAddress(answer6(address))).toBe(true);
 });

 it.each([
  '::','::1','::ffff:8.8.8.8','::ffff:0808:0808','64:ff9b::808:808','64:ff9b:1::808:808',
  '2001::1','2001:db8::1','2002:0808:0808::1','3fff::1','fc00::1','fe80::1','ff02::1','3000::1',
 ])('rejects non-public IPv6 %s',address=>expect(isPublicAddress(answer6(address))).toBe(false));

 it.each([
  {address:'8.8.8.8',family:6 as const},
  {address:'2606:4700:4700::1111',family:4 as const},
  {address:'999.1.1.1',family:4 as const},
  {address:'2606:4700::zz',family:6 as const},
  {address:'fe80::1%eth0',family:6 as const},
  {address:'',family:4 as const},
 ])('fails closed for malformed or mismatched address objects %#',address=>expect(isPublicAddress(address)).toBe(false));
});

describe('resolvePublicAddresses',()=>{
 it('queries both address families with one cancellable per-call resolver',async()=>{
  dns.resolver.resolve4.mockResolvedValue(['8.8.8.8']);
  dns.resolver.resolve6.mockResolvedValue(['2606:4700:4700::1111']);
  const signal=new AbortController().signal;
  await expect(resolvePublicAddresses('API.Compatible-Provider.COM',signal)).resolves.toEqual([
   answer4('8.8.8.8'),answer6('2606:4700:4700::1111'),
  ]);
  expect(dns.Resolver).toHaveBeenCalledTimes(1);
  const options=dns.Resolver.mock.calls[0]?.[0] as {timeout:number;tries:number};
  expect(options.tries).toBe(1);
  expect(options.timeout).toBeGreaterThan(0);
  expect(options.timeout).toBeLessThanOrEqual(5000);
  expect(dns.resolver.resolve4).toHaveBeenCalledWith('api.compatible-provider.com');
  expect(dns.resolver.resolve6).toHaveBeenCalledWith('api.compatible-provider.com');
 });

 it('allows one empty address family when the other has public answers',async()=>{
  dns.resolver.resolve4.mockResolvedValue(['8.8.8.8']);
  dns.resolver.resolve6.mockRejectedValue(dnsError('ENODATA'));
  await expect(resolvePublicAddresses('api.compatible-provider.com',new AbortController().signal)).resolves.toEqual([answer4('8.8.8.8')]);
 });

 it('rejects when both address families have no data',async()=>{
  dns.resolver.resolve4.mockRejectedValue(dnsError('ENODATA'));
  dns.resolver.resolve6.mockRejectedValue(dnsError('ENODATA'));
  await expect(resolvePublicAddresses('api.compatible-provider.com',new AbortController().signal)).rejects.toMatchObject({
   code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE',
  });
 });

 it('normalizes Node resolver timeout errors as TIMEOUT',async()=>{
  dns.resolver.resolve4.mockRejectedValue(dnsError('ETIMEOUT'));
  dns.resolver.resolve6.mockReturnValue(new Promise(()=>{}));
  await expect(resolvePublicAddresses('api.compatible-provider.com',new AbortController().signal)).rejects.toMatchObject({
   code:'TIMEOUT',message:'TIMEOUT',
  });
  expect(dns.resolver.cancel).toHaveBeenCalledTimes(1);
 });

 it('rejects the complete answer set if any address is private',async()=>{
  dns.resolver.resolve4.mockResolvedValue(['8.8.8.8','10.0.0.1']);
  await expect(resolvePublicAddresses('api.compatible-provider.com',new AbortController().signal)).rejects.toMatchObject({
   code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE',
  });
 });

 it('rejects more than 64 total DNS answers',async()=>{
  dns.resolver.resolve4.mockResolvedValue(Array.from({length:65},()=> '8.8.8.8'));
  await expect(resolvePublicAddresses('api.compatible-provider.com',new AbortController().signal)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
 });

 it('normalizes resolver errors without exposing the hostname or resolver message',async()=>{
  dns.resolver.resolve4.mockRejectedValue(new Error('secret resolver detail for api.compatible-provider.com'));
  dns.resolver.resolve6.mockRejectedValue(new Error('secret resolver detail for api.compatible-provider.com'));
  let error:unknown;
  try{await resolvePublicAddresses('api.compatible-provider.com',new AbortController().signal);}catch(caught){error=caught;}
  expect(error).toBeInstanceOf(AIProviderError);
  expect(error).toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE'});
  expect((error as Error).message).not.toContain('api.compatible-provider.com');
  expect((error as Error).message).not.toContain('secret resolver detail');
 });

 it('rejects invalid hostnames before constructing a resolver',async()=>{
  await expect(resolvePublicAddresses('127.0.0.1',new AbortController().signal)).rejects.toMatchObject({code:'INVALID_REQUEST'});
  await expect(resolvePublicAddresses('api.local',new AbortController().signal)).rejects.toMatchObject({code:'INVALID_REQUEST'});
  expect(dns.Resolver).not.toHaveBeenCalled();
 });

 it('honors an already-aborted signal before starting DNS',async()=>{
  const controller=new AbortController();
  controller.abort();
  await expect(resolvePublicAddresses('api.compatible-provider.com',controller.signal)).rejects.toMatchObject({code:'CANCELLED'});
  expect(dns.Resolver).not.toHaveBeenCalled();
 });

 it('does not start queued DNS work if the signal aborts before the lookup microtask',async()=>{
  const controller=new AbortController();
  const pending=resolvePublicAddresses('api.compatible-provider.com',controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({code:'CANCELLED'});
  await Promise.resolve();
  expect(dns.resolver.resolve4).not.toHaveBeenCalled();
  expect(dns.resolver.resolve6).not.toHaveBeenCalled();
 });

 it('cancels the resolver and returns CANCELLED when aborted during DNS',async()=>{
  dns.resolver.resolve4.mockReturnValue(new Promise(()=>{}));
  dns.resolver.resolve6.mockReturnValue(new Promise(()=>{}));
  const controller=new AbortController();
  const pending=resolvePublicAddresses('api.compatible-provider.com',controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({code:'CANCELLED',message:'CANCELLED'});
  expect(dns.resolver.cancel).toHaveBeenCalledTimes(1);
 });

 it('resolves fresh address answers for each call rather than caching a prior result',async()=>{
  dns.resolver.resolve4.mockResolvedValueOnce(['8.8.8.8']).mockResolvedValueOnce(['10.0.0.1']);
  await expect(resolvePublicAddresses('api.compatible-provider.com',new AbortController().signal)).resolves.toEqual([answer4('8.8.8.8')]);
  await expect(resolvePublicAddresses('api.compatible-provider.com',new AbortController().signal)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
  expect(dns.Resolver).toHaveBeenCalledTimes(2);
 });

 it('cancels unresolved DNS within the five-second deadline',async()=>{
  vi.useFakeTimers();
  try{
   dns.resolver.resolve4.mockReturnValue(new Promise(()=>{}));
   dns.resolver.resolve6.mockReturnValue(new Promise(()=>{}));
   const pending=resolvePublicAddresses('api.compatible-provider.com',new AbortController().signal);
   const assertion=expect(pending).rejects.toMatchObject({code:'TIMEOUT',message:'TIMEOUT'});
   await vi.advanceTimersByTimeAsync(5000);
   await assertion;
   expect(dns.resolver.cancel).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers();}
 });
});
