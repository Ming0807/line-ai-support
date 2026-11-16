import {describe,expect,it} from 'vitest';
import {buildOcrSessionEnvironment,validateOcrHealth,OCR_MODEL,OCR_REVISION} from '../scripts/local/config.mjs';

// OCR-IMP-02 (DEC-207): pnpm local starts services/ocr only when services/ocr/.env exists; OCR stays optional.
const service={OCR_MODEL_DIR:'D:/AI/Models/openthai2-ocr-text/40e8e9f',OCR_HOST:'127.0.0.1',OCR_PORT:'8010'};

describe('OCR-IMP-02 local OCR session configuration',()=>{
 it('maps the service file to a loopback session endpoint and enables the import OCR buttons for this session only',()=>{
  const result=buildOcrSessionEnvironment({},service);
  expect(result).toEqual({OCR_MODEL_DIR:service.OCR_MODEL_DIR,OCR_HOST:'127.0.0.1',OCR_PORT:'8010',OCR_API_URL:'http://127.0.0.1:8010',KNOWLEDGE_IMPORT_OCR_ENABLED:'true'});
 });
 it('defaults host and port like the service and keeps a matching key',()=>{
  expect(buildOcrSessionEnvironment({},{OCR_MODEL_DIR:'x'})?.OCR_API_URL).toBe('http://127.0.0.1:8010');
  const key='k'.repeat(24);
  expect(buildOcrSessionEnvironment({OCR_API_KEY:key},{...service,OCR_API_KEY:key})?.OCR_API_KEY).toBe(key);
 });
 it('returns null without a service file and rejects unsafe or inconsistent settings',()=>{
  expect(buildOcrSessionEnvironment({},null)).toBeNull();
  for(const bad of [{...service,OCR_HOST:'0.0.0.0'},{...service,OCR_PORT:'99999'},{...service,OCR_PORT:'80a'},{...service,OCR_MODEL_DIR:''},
   {OCR_HOST:'127.0.0.1'},{...service,EXTRA:'1'},{...service,OCR_API_KEY:'short'}])
   expect(()=>buildOcrSessionEnvironment({},bad as Record<string,string>),JSON.stringify(bad)).toThrow(/LOCAL_OCR_CONFIG_INVALID/u);
  expect(()=>buildOcrSessionEnvironment({OCR_API_URL:'http://127.0.0.1:9999'},service)).toThrow(/LOCAL_OCR_CONFIG_INVALID/u);
  expect(()=>buildOcrSessionEnvironment({OCR_API_KEY:'x'.repeat(20)},service)).toThrow(/LOCAL_OCR_CONFIG_INVALID/u);
 });
 it('accepts only the pinned model revision as healthy',()=>{
  expect(validateOcrHealth({model:OCR_MODEL,revision:OCR_REVISION,healthy:true})).toBe(true);
  expect(OCR_REVISION).toBe('40e8e9ff752b65153b1a71d521ec9390882afd7e');
  for(const bad of [null,{},{model:OCR_MODEL,revision:OCR_REVISION,healthy:false},{model:'other',revision:OCR_REVISION,healthy:true},{model:OCR_MODEL,revision:'main',healthy:true}])
   expect(validateOcrHealth(bad)).toBe(false);
 });
});
