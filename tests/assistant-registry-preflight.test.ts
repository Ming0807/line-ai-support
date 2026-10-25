import {expect,it,vi} from 'vitest';
import {readRegistryPreflight} from '../scripts/qa/assistant-registry-preflight';

it('re-reads once after a reset without caching a registry snapshot',async()=>{
 const reset=Object.assign(new Error('private detail'),{code:'ECONNRESET'});
 const read=vi.fn().mockRejectedValueOnce(reset).mockResolvedValueOnce([{revision:9}]);
 const pause=vi.fn(async()=>{}),observe=vi.fn();
 expect(await readRegistryPreflight(read,{pause,observe})).toEqual([{revision:9}]);
 expect(read).toHaveBeenCalledTimes(2);expect(pause).toHaveBeenCalledExactlyOnceWith(250);
 expect(observe.mock.calls).toEqual([[{stage:'registry_read_only_retry',attempt:2,code:'ECONNRESET'}]]);
});
it('propagates a second reset and never starts a third read',async()=>{
 const error=Object.assign(new Error('reset'),{code:'ECONNRESET'}),read=vi.fn().mockRejectedValue(error);
 await expect(readRegistryPreflight(read,{pause:async()=>{}})).rejects.toBe(error);
 expect(read).toHaveBeenCalledTimes(2);
});
it.each(['28P01','42501','57014','ETIMEDOUT',undefined])('does not retry error %s',async code=>{
 const error=Object.assign(new Error('failure'),{code}),read=vi.fn().mockRejectedValue(error),pause=vi.fn();
 await expect(readRegistryPreflight(read,{pause})).rejects.toBe(error);
 expect(read).toHaveBeenCalledTimes(1);expect(pause).not.toHaveBeenCalled();
});
it('returns a successful first read without delay',async()=>{
 const read=vi.fn(async()=>[]),pause=vi.fn();
 expect(await readRegistryPreflight(read,{pause})).toEqual([]);
 expect(read).toHaveBeenCalledTimes(1);expect(pause).not.toHaveBeenCalled();
});
