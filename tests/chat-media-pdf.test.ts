import {expect,it} from 'vitest';
import {CHAT_MEDIA_MAX_BYTES,ChatMediaError,inspectChatMedia} from '../lib/chat/media-binary';
import {verifyChatMediaPdf} from '../lib/chat/media-pdf';
import {createPdfFixture} from './fixtures/import-pdf';

const encoder=new TextEncoder();
const validPdf=createPdfFixture([{lines:[{text:'Synthetic attachment fixture',y:720}]}]);

it('accepts a real one-page PDF and leaves its exact source bytes intact',async()=>{
 const before=validPdf.slice();
 const inspected=inspectChatMedia(validPdf,'application/pdf','FILE',validPdf.byteLength);
 expect(inspected).toMatchObject({mimeType:'application/pdf',byteLength:validPdf.byteLength});
 await verifyChatMediaPdf(validPdf);
 expect(Array.from(validPdf)).toEqual(Array.from(before));
},15000);

it('rejects arbitrary content wrapped in a PDF header and EOF marker',async()=>{
 const wrappedJunk=encoder.encode('%PDF-1.7\nnot a PDF object graph\n%%EOF\n');
 expect(()=>inspectChatMedia(wrappedJunk,'application/pdf','FILE')).not.toThrow();
 await expect(verifyChatMediaPdf(wrappedJunk)).rejects.toMatchObject({code:'INVALID_ATTACHMENT'});
},15000);

it('rejects inputs above the shared ten-megabyte attachment limit before parsing',async()=>{
 const oversized=new Uint8Array(CHAT_MEDIA_MAX_BYTES+1);
 oversized.set(encoder.encode('%PDF-1.7\n'));
 await expect(verifyChatMediaPdf(oversized)).rejects.toMatchObject({code:'TOO_LARGE'});
});

it('exposes no parser diagnostics or document content in invalid-file errors',async()=>{
 const privateFixture=encoder.encode('%PDF-1.7\nPRIVATE_STUDENT_RECORD fixture\n%%EOF\n');
 try{await verifyChatMediaPdf(privateFixture);throw new Error('EXPECTED_INVALID_PDF');}
 catch(error){
  expect(error).toBeInstanceOf(ChatMediaError);
  expect(String(error)).not.toContain('PRIVATE_STUDENT_RECORD');
  expect(String(error)).not.toContain('object graph');
 }
},15000);
