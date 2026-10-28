import {expect,it} from 'vitest';
import {parsePublicFamilyCatalog,familySelectionIsKnown} from '../lib/knowledge/family-catalog';
const entry={code:'WIFI_GUIDE',name:'คู่มือ Wi-Fi',category:'GUIDE'};
it('copies and freezes bounded public navigation metadata and validates selected exact codes',()=>{
 const input=[{...entry}],catalog=parsePublicFamilyCatalog(input);expect(catalog).not.toBeNull();if(!catalog)throw new Error('EXPECTED_CATALOG');
 input[0].name='changed';expect(catalog[0].name).toBe(entry.name);expect(Object.isFrozen(catalog[0])).toBe(true);
 expect(familySelectionIsKnown(['WIFI_GUIDE'],catalog)).toBe(true);expect(familySelectionIsKnown(['INVENTED'],catalog)).toBe(false);
 expect(familySelectionIsKnown(['WIFI_GUIDE','WIFI_GUIDE'],catalog)).toBe(false);expect(familySelectionIsKnown([],catalog)).toBe(true);
});
it('does not silently truncate an oversized catalog or invent an empty successful one',()=>{
 expect(parsePublicFamilyCatalog(Array.from({length:51},(_,i)=>({...entry,code:`FAMILY_${i}`})))).toBeNull();
 expect(parsePublicFamilyCatalog(Array.from({length:30},(_,i)=>({...entry,code:`FAMILY_${i}`,name:'ก'.repeat(500)})))).toBeNull();
 expect(parsePublicFamilyCatalog(Array.from({length:50},(_,i)=>({...entry,code:`FAMILY_${i}`,name:'ก'.repeat(500)})))).toBeNull();
 expect(parsePublicFamilyCatalog(null)).toBeNull();expect(parsePublicFamilyCatalog([])).toEqual([]);
});
it('rejects malformed, duplicate, inherited and accessor-bearing metadata without invoking getters',()=>{
 for(const input of [[entry,entry],[{...entry,code:'unregistered lowercase'}],[{...entry,privateNote:'secret'}],{},'bad'])expect(()=>parsePublicFamilyCatalog(input)).toThrow('KNOWLEDGE_CATALOG_INVALID');
 let called=false;const getter={...entry,get name(){called=true;return 'private';}};
 expect(()=>parsePublicFamilyCatalog([getter])).toThrow('KNOWLEDGE_CATALOG_INVALID');expect(called).toBe(false);
 expect(()=>parsePublicFamilyCatalog([Object.create(entry)])).toThrow('KNOWLEDGE_CATALOG_INVALID');
});
