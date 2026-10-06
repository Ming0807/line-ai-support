import {expect,it} from 'vitest';
import {transformStructuredCell} from '../lib/imports/structured-transforms';
import type {StructuredTransform} from '../lib/imports/structured-mapping-contract';

const convert=(transform:StructuredTransform,value:string,blank:'REJECT'|'NULL'='REJECT')=>transformStructuredCell({kind:'COLUMN',columnIndex:0,transform,blank},value);
it('preserves exact text, ungrouped decimals and fractional zeros while removing only explicitly approved comma grouping',()=>{
 expect(convert('TEXT_V1',' 001 วิชา 💡 ')).toBe(' 001 วิชา 💡 ');
 expect(convert('DECIMAL_V1','1234.50')).toBe('1234.50');
 expect(convert('DECIMAL_COMMA_V1','1,234.50')).toBe('1234.50');
 expect(convert('DECIMAL_COMMA_V1','0.00')).toBe('0.00');
 for(const value of ['01','0,001','1,23.00','1,234,56','1.234,00','1e3',' 1,234 ','1,234.','-1,234','1\n'])expect(()=>convert('DECIMAL_COMMA_V1',value)).toThrowError(/^STRUCTURED_MAPPING_ROW_INVALID$/);
});
it('converts only explicitly selected date order/era and validates civil dates before timezone conversion',()=>{
 expect(convert('DATE_DMY_BUDDHIST_V1','01/03/2569')).toBe('2026-03-01');
 expect(convert('DATE_BUDDHIST_V1','2569-10-07')).toBe('2026-10-07');
 expect(convert('DATE_DMY_GREGORIAN_V1','29/02/2024')).toBe('2024-02-29');
 for(const [transform,value] of [['DATE_GREGORIAN_V1','2026-02-29'],['DATE_BUDDHIST_V1','2569-02-29'],['DATE_DMY_GREGORIAN_V1','03-01-2026'],['DATE_DMY_BUDDHIST_V1','1/3/2569']] satisfies [StructuredTransform,string][])expect(()=>convert(transform,value)).toThrowError(/^STRUCTURED_MAPPING_ROW_INVALID$/);
});
it('requires an explicit fixed +07 offset or midnight policy without using the host timezone or current date',()=>{
 expect(convert('TIMESTAMP_PLUS07_V1','2026-10-07 08:00:00.000')).toBe('2026-10-07T01:00:00.000Z');
 expect(convert('DATE_BUDDHIST_PLUS07_MIDNIGHT_V1','2569-10-07')).toBe('2026-10-06T17:00:00.000Z');
 for(const value of ['2026-02-29 08:00:00.000','2026-10-07 24:00:00.000','2026-10-07T08:00:00.000','1800-01-01 00:00:00.000'])expect(()=>convert('TIMESTAMP_PLUS07_V1',value)).toThrowError(/^STRUCTURED_MAPPING_ROW_INVALID$/);
});
it('allows only reviewed blank-to-null and canonical bounded integers without numeric coercion',()=>{
 expect(convert('TEXT_V1',' \t ','NULL')).toBe(null);
 expect(()=>convert('INTEGER_V1',' ','REJECT')).toThrowError(/^STRUCTURED_MAPPING_ROW_INVALID$/);
 expect(convert('INTEGER_V1','2569')).toBe(2569);
 for(const value of ['02569','1.0','1e2','+1','-1','1000000000','2569\n'])expect(()=>convert('INTEGER_V1',value)).toThrowError(/^STRUCTURED_MAPPING_ROW_INVALID$/);
});
