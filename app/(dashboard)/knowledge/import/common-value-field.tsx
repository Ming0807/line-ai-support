'use client';

import {useState} from 'react';

export type CommonFieldOption={value:string;label:string};
type CommonValueFieldProps={
 id:string;
 label:string;
 value:string|null;
 options:readonly CommonFieldOption[];
 onChange:(value:string|null)=>void;
 disabled:boolean;
 maxLength:number;
};

export function getCommonValueFieldState(value:string|null,options:readonly CommonFieldOption[],customMode:boolean){
 const isCommon=value!==null&&options.some(option=>option.value===value);
 const showCustom=customMode||(value!==null&&!isCommon);
 return {isCommon,showCustom,selected:isCommon&&!customMode?value:showCustom?'CUSTOM':value??''};
}

export function selectCommonValue(selected:string,currentValue:string|null,options:readonly CommonFieldOption[]){
 if(selected==='CUSTOM'){
  const currentIsCommon=currentValue!==null&&options.some(option=>option.value===currentValue);
  return {value:currentIsCommon?null:currentValue,customMode:true};
 }
 return {value:selected===''?null:selected,customMode:false};
}

export default function CommonValueField({id,label,value,options,onChange,disabled,maxLength}:CommonValueFieldProps){
 const [customMode,setCustomMode]=useState(()=>value!==null&&!options.some(option=>option.value===value));
 const fieldState=getCommonValueFieldState(value,options,customMode);
 return <>
  <select id={id} aria-label={label} value={fieldState.selected} disabled={disabled} onChange={event=>{
   const next=selectCommonValue(event.target.value,value,options);
   setCustomMode(next.customMode);
   if(next.value!==value)onChange(next.value);
  }}>
   <option value="">เลือกค่า</option>
   {options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
   <option value="CUSTOM">ค่าอื่น (ระบุเอง)</option>
  </select>
  {fieldState.showCustom&&<input
   id={`${id}-custom`}
   type="text"
   aria-label={`${label} · ระบุค่าเอง`}
   value={value??''}
   maxLength={maxLength}
   disabled={disabled}
   onChange={event=>{setCustomMode(true);onChange(event.target.value===''?null:event.target.value);}}
  />}
 </>;
}
