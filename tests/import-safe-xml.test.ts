import {expect,it} from 'vitest';
import {parseSafeXml,xmlAttribute,xmlChildren,xmlText} from '../lib/imports/safe-xml';
const bytes=(text:string)=>Buffer.from(text,'utf8');
it('preserves namespace identity, Thai text, decoded entities and ordered mixed content',()=>{
 const root=parseSafeXml(bytes('<?xml version="1.0" encoding="UTF-8"?><w:p xmlns:w="urn:word" w:label=" 001 ">ก่อน<w:t>หัวข้อ &amp; &#x0E01;</w:t><![CDATA[<หลัง>]]></w:p>'));
 expect(root).toMatchObject({local:'p',uri:'urn:word'});expect(xmlAttribute(root,'label','urn:word')).toBe(' 001 ');
 expect(xmlText(root)).toBe('ก่อนหัวข้อ & ก<หลัง>');expect(xmlChildren(root,'t','urn:word')).toHaveLength(1);
 expect(root.children[0]).toBe('ก่อน');expect(root.children[2]).toBe('<หลัง>');
 expect(Object.isFrozen(root)&&Object.isFrozen(root.children)&&Object.isFrozen(root.attributes)).toBe(true);
});
it.each([
 '<a><b></a>','<a x="1" x="2"/>','<a>&unknown;</a>','<w:a/>','<a/><b/>',
 '<!DOCTYPE a SYSTEM "file:///private"><a/>','<!DOCTYPE a [<!ENTITY q "private">]><a>&q;</a>',
 '<?source href="https://private.invalid"?><a/>','<?xml version="1.1"?><a/>','<?xml version="1.0" encoding="UTF-16"?><a/>',
 '<a>\u0000</a>',
])('rejects malformed or active XML with fixed errors %#',text=>{
 expect(()=>parseSafeXml(bytes(text))).toThrow(/^IMPORT_XML_INVALID$/);
});
it('refuses empty, broken UTF8 and oversized buffers',()=>{
 for(const value of [new Uint8Array(),new Uint8Array([0xff,0xfe]),new Uint8Array(16*1024*1024+1)])expect(()=>parseSafeXml(value)).toThrow(/^IMPORT_XML_INVALID$/);
});
it('enforces depth, attribute count, node count and measured text limits',()=>{
 for(const xml of [Array(65).fill('<a>').join('')+Array(65).fill('</a>').join(''),
  '<a '+Array.from({length:257},(_,i)=>`k${i}="v"`).join(' ')+'/>',
  '<a>'+Array(100_000).fill('<b/>').join('')+'</a>',
  '<a>'+'x'.repeat(5_000_001)+'</a>'])expect(()=>parseSafeXml(bytes(xml))).toThrow(/^IMPORT_XML_INVALID$/);
});
it('keeps XML whitespace/numeric strings and does not confuse unnamespaced attributes',()=>{
 const root=parseSafeXml(bytes('<a xmlns:s="urn:s" value="001" s:value="002">  001\n </a>'));
 expect(xmlAttribute(root,'value')).toBe('001');expect(xmlAttribute(root,'value','urn:s')).toBe('002');expect(xmlText(root)).toBe('  001\n ');
 expect(xmlAttribute(root,'absent')).toBeNull();
});
it('bounds ordered text/CDATA segment allocation independently of text character count',()=>{
 const segment='<![CDATA[x]]>';
 expect(xmlText(parseSafeXml(bytes('<a>'+segment.repeat(200_000)+'</a>')))).toHaveLength(200_000);
 expect(()=>parseSafeXml(bytes('<a>'+segment.repeat(200_001)+'</a>'))).toThrow(/^IMPORT_XML_INVALID$/);
});
