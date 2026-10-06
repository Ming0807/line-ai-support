import {STRUCTURED_REGISTRY_VERSION,StructuredPayloadError,isStructuredDataset,type StructuredDataset} from './structured-payload';

export type StructuredFieldKind='TEXT'|'INTEGER'|'DATE'|'TIMESTAMP'|'DECIMAL'|'CURRENCY'|'EMAIL'|'URL';
export interface StructuredField {
 readonly name:string;readonly kind:StructuredFieldKind;readonly nullable:boolean;
 readonly maxLength?:number;readonly precision?:number;readonly scale?:number;readonly min?:number;readonly max?:number;
}
export interface StructuredRegistryEntry {
 readonly dataset:StructuredDataset;readonly version:typeof STRUCTURED_REGISTRY_VERSION;
 readonly installed:false;readonly fields:readonly StructuredField[];
}
type Bounds=Pick<StructuredField,'maxLength'|'precision'|'scale'|'min'|'max'>;
const field=(name:string,kind:StructuredFieldKind,nullable=false,bounds:Bounds={}):StructuredField=>Object.freeze({name,kind,nullable,...bounds});
const text=(name:string,maxLength:number,nullable=false)=>field(name,'TEXT',nullable,{maxLength});
const year=()=>field('academic_year','INTEGER',false,{min:2400,max:3000});
const entry=(dataset:StructuredDataset,fields:StructuredField[]):StructuredRegistryEntry=>Object.freeze({dataset,version:STRUCTURED_REGISTRY_VERSION,installed:false,fields:Object.freeze(fields)});

/** Inert metadata only. No SQL identifiers, readiness setters or source-supplied fields. */
const registry=Object.freeze({
 academic_calendar_events:entry('academic_calendar_events',[
  year(),text('semester',80),text('student_type',80),text('event_type',200),text('title',500),field('start_date','DATE'),field('end_date','DATE',true),text('description',5000,true),
 ]),
 tuition_fees:entry('tuition_fees',[
  year(),text('program_name',500),text('major_name',500,true),text('student_group',200),text('study_type',200),field('fee_amount','DECIMAL',false,{precision:12,scale:2}),field('currency','CURRENCY',false,{maxLength:3}),field('effective_from','DATE'),field('effective_to','DATE',true),
 ]),
 transfer_courses:entry('transfer_courses',[
  text('source_program',500),text('source_course_code',200),text('source_course_name',500),field('source_credits','DECIMAL',false,{precision:6,scale:3}),text('target_program',500),text('target_course_code',200),text('target_course_name',500),field('target_credits','DECIMAL',false,{precision:6,scale:3}),text('conditions',5000,true),
 ]),
 university_services:entry('university_services',[
  text('service_code',200),text('name',500),text('description',5000,true),text('location',500,true),text('opening_hours',2000,true),text('phone',100,true),field('email','EMAIL',true,{maxLength:254}),field('url','URL',true,{maxLength:2000}),
 ]),
 university_systems:entry('university_systems',[
  text('code',200),text('name',500),text('description',5000,true),field('url','URL',false,{maxLength:2000}),field('support_url','URL',true,{maxLength:2000}),
 ]),
 service_forms:entry('service_forms',[
  text('name',500),text('description',5000,true),field('form_url','URL',false,{maxLength:2000}),text('requirements',5000,true),
 ]),
 announcements:entry('announcements',[
  text('title',500),text('summary',5000,true),field('publish_at','TIMESTAMP'),field('effective_from','TIMESTAMP'),field('effective_to','TIMESTAMP',true),field('priority','INTEGER',false,{min:0,max:100}),
 ]),
} satisfies Record<StructuredDataset,StructuredRegistryEntry>);

export function getStructuredRegistryEntry(dataset:unknown):StructuredRegistryEntry {
 if(!isStructuredDataset(dataset))throw new StructuredPayloadError('STRUCTURED_DATASET_UNSUPPORTED');
 return registry[dataset];
}
