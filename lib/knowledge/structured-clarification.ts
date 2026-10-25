/** Labels for backend-validated missing selectors; never echo model-provided keys. */
const labels:Readonly<Record<string,string>>={
 academic_year:'ปีการศึกษา',semester:'ภาคเรียน',student_type:'ประเภทนักศึกษา',
 program_name:'ชื่อหลักสูตร',student_group:'กลุ่มนักศึกษา',study_type:'รูปแบบการศึกษา',
 source_program:'หลักสูตรต้นทาง',source_course_code:'รหัสวิชาต้นทาง',target_program:'หลักสูตรปลายทาง',
 'service_code|name|location':'ชื่อบริการหรือสถานที่ให้บริการ',
 'code|name':'ชื่อระบบ',
 'name|form_url':'ชื่อแบบฟอร์มที่ต้องการ',
 'title|effective_at':'ชื่อประกาศหรือวันที่ที่ต้องการค้น',
};
export function missingStructuredDetails(missing:readonly string[]):string {
 const fields=[...new Set(missing.map(field=>labels[field]).filter((field):field is string=>Boolean(field)))];
 return fields.length?`เพื่อค้นข้อมูลให้ตรงเรื่อง รบกวนระบุ${fields.join(' และ ')}เพิ่มเติมครับ`:
  'รบกวนระบุเรื่องที่ต้องการค้นเพิ่มเติมครับ';
}
