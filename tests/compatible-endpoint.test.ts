import {expect,it} from 'vitest';
import {AIProviderError} from '../lib/ai/types';
import {parseCompatibleBaseUrl} from '../lib/ai/compatible-endpoint';

it('canonicalizes host case, IDN, default port, trailing host dot, and prefix slash',()=>{
 expect(parseCompatibleBaseUrl('https://API.Compatible-Provider.COM.:443/v1/')).toEqual({
  baseUrl:'https://api.compatible-provider.com/v1',origin:'https://api.compatible-provider.com',hostname:'api.compatible-provider.com',pathPrefix:'/v1',
 });
 expect(parseCompatibleBaseUrl('https://bücher.compatible-provider.com/openai/v1')).toMatchObject({
  baseUrl:'https://xn--bcher-kva.compatible-provider.com/openai/v1',hostname:'xn--bcher-kva.compatible-provider.com',pathPrefix:'/openai/v1',
 });
});

it('canonicalizes root endpoints without a trailing slash',()=>{
 expect(parseCompatibleBaseUrl('https://api.compatible-provider.com/')).toEqual({
  baseUrl:'https://api.compatible-provider.com',origin:'https://api.compatible-provider.com',hostname:'api.compatible-provider.com',pathPrefix:'',
 });
});

it.each([
 ['example.com','https://example.com/v1'],
 ['example.com subdomain with mixed case and trailing dot','https://API.Example.COM./v1'],
 ['example.net','https://example.net/v1'],
 ['example.net subdomain','https://api.example.net/v1'],
 ['example.org','https://example.org/v1'],
 ['example.org subdomain','https://api.example.org/v1'],
 ['alt','https://provider.alt/v1'],
 ['alt with mixed case and trailing dot','https://Provider.ALT./v1'],
])('rejects IANA special-use hostname %s',(_label,value)=>{
 expect(()=>parseCompatibleBaseUrl(value)).toThrowError(AIProviderError);
});

it.each([
 'https://api.notexample.com/v1',
 'https://api.example.com.evil/v1',
 'https://provider.altitude/v1',
])('accepts hostname lookalike outside special-use label boundary: %s',value=>{
 expect(parseCompatibleBaseUrl(value).hostname).toBe(new URL(value).hostname);
});

it.each([
 ['not a string',null],
 ['empty URL',''],
 ['plain HTTP','http://api.compatible-provider.com/v1'],
 ['credentials','https://user:secret@api.compatible-provider.com/v1'],
 ['empty userinfo','https://@api.compatible-provider.com/v1'],
 ['query','https://api.compatible-provider.com/v1?tenant=one'],
 ['empty query delimiter','https://api.compatible-provider.com/v1?'],
 ['fragment','https://api.compatible-provider.com/v1#section'],
 ['empty fragment delimiter','https://api.compatible-provider.com/v1#'],
 ['non-default port','https://api.compatible-provider.com:8443/v1'],
 ['IPv4 literal','https://8.8.8.8/v1'],
 ['IPv6 literal','https://[2606:4700:4700::1111]/v1'],
 ['single-label host','https://gateway/v1'],
 ['localhost','https://localhost/v1'],
 ['localhost subdomain','https://api.localhost/v1'],
 ['local suffix','https://api.local/v1'],
 ['internal suffix','https://api.internal/v1'],
 ['test suffix','https://api.example.test/v1'],
 ['home.arpa suffix','https://router.home.arpa/v1'],
 ['backslash','https://api.compatible-provider.com\\v1'],
 ['space in path','https://api.compatible-provider.com/v1 path'],
 ['control character','https://api.compatible-provider.com/v1\npath'],
 ['duplicate path slash','https://api.compatible-provider.com/v1//proxy'],
 ['dot path segment','https://api.compatible-provider.com/v1/../private'],
 ['dot current segment','https://api.compatible-provider.com/v1/./proxy'],
 ['encoded slash','https://api.compatible-provider.com/v1%2fproxy'],
 ['encoded dot','https://api.compatible-provider.com/v1/%2e%2e/private'],
 ['models route suffix','https://api.compatible-provider.com/v1/models'],
 ['chat route suffix','https://api.compatible-provider.com/v1/chat/completions'],
 ['embedding route suffix','https://api.compatible-provider.com/v1/embeddings'],
])('rejects %s with a normalized error and no input echo',(_label,value)=>{
 let error:unknown;
 try{parseCompatibleBaseUrl(value);}catch(caught){error=caught;}
 expect(error).toBeInstanceOf(AIProviderError);
 expect(error).toMatchObject({code:'INVALID_REQUEST',message:'INVALID_REQUEST'});
 const raw=String(value);
 if(raw)expect((error as Error).message).not.toContain(raw);
});
