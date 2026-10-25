import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import CommonValueField,{getCommonValueFieldState,selectCommonValue} from '@/app/(dashboard)/knowledge/import/common-value-field';

const options=[{value:'ALL',label:'ทุกกลุ่ม'},{value:'STUDENT',label:'นักศึกษา'}] as const;
const render=(value:string|null,disabled=false)=>renderToStaticMarkup(createElement(CommonValueField,{
 id:'review-audience',label:'กลุ่มผู้ใช้ข้อมูล',value,options,onChange:()=>undefined,disabled,maxLength:80,
}));

it('keeps ALL available without selecting it for an unresolved scope',()=>{
 const html=render(null);
 expect(html).toContain('<option value="ALL">ทุกกลุ่ม</option>');
 expect(html).toContain('<option value="" selected="">เลือกค่า</option>');
 expect(html).not.toContain('<option value="ALL" selected="">');
});

it('keeps an existing custom value visible and selected',()=>{
 const html=render('ผู้ใช้ตามประกาศ');
 expect(html).toContain('<option value="CUSTOM" selected="">ค่าอื่น (ระบุเอง)</option>');
 expect(html).toContain('value="ผู้ใช้ตามประกาศ"');
});

it('shows a custom value delivered after the control first rendered',()=>{
 expect(getCommonValueFieldState('new custom value',options,false)).toEqual({selected:'CUSTOM',showCustom:true,isCommon:false});
});

it('keeps custom editing when its text matches a common option',()=>{
 expect(getCommonValueFieldState('ALL',options,true)).toEqual({selected:'CUSTOM',showCustom:true,isCommon:true});
});

it('clears a selected common value once when choosing custom entry',()=>{
 expect(selectCommonValue('CUSTOM','ALL',options)).toEqual({value:null,customMode:true});
 expect(selectCommonValue('CUSTOM',null,options)).toEqual({value:null,customMode:true});
});

it('disables both selection and custom entry when the review is locked',()=>{
 const html=render('CUSTOM-AUDIENCE',true);
 expect(html).toMatch(/<select id="review-audience"[^>]*disabled="">/u);
 expect(html).toContain('id="review-audience-custom"');
 expect(html).toContain('value="CUSTOM-AUDIENCE"');
 expect(html.match(/disabled=""/gu)).toHaveLength(2);
});
