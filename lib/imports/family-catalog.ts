export type InitialDocumentFamily = {
  code: string;
  name: string;
  category: string;
};

const initialDocumentFamilies: InitialDocumentFamily[] = [
  { code: 'ACADEMIC_CALENDAR', name: 'ปฏิทินการศึกษา', category: 'ปฏิทินและการลงทะเบียน' },
  { code: 'REGISTRATION_GUIDE', name: 'คู่มือการลงทะเบียนเรียน', category: 'ปฏิทินและการลงทะเบียน' },
  { code: 'TRANSFER_REGULATION', name: 'ระเบียบการเทียบโอนผลการเรียน', category: 'การเทียบโอนผลการเรียน' },
  { code: 'TRANSFER_GUIDE', name: 'คู่มือการเทียบโอนผลการเรียน', category: 'การเทียบโอนผลการเรียน' },
  { code: 'TRANSFER_COURSE_TABLE', name: 'ตารางรายวิชาเทียบโอน', category: 'การเทียบโอนผลการเรียน' },
  { code: 'TUITION_FEE', name: 'ข้อมูลค่าธรรมเนียมการศึกษา', category: 'การเงินการศึกษา' },
  { code: 'EXAM_REGULATION', name: 'ระเบียบการสอบ', category: 'การสอบและผลการศึกษา' },
  { code: 'GRADING_REGULATION', name: 'ระเบียบการวัดและประเมินผลการศึกษา', category: 'การสอบและผลการศึกษา' },
  { code: 'TRANSCRIPT_GUIDE', name: 'คู่มือการขอใบแสดงผลการศึกษา', category: 'เอกสารและบริการการศึกษา' },
  { code: 'CERTIFICATE_GUIDE', name: 'คู่มือการขอหนังสือรับรอง', category: 'เอกสารและบริการการศึกษา' },
  { code: 'COURSE_WITHDRAWAL_GUIDE', name: 'คู่มือการถอนรายวิชา', category: 'ปฏิทินและการลงทะเบียน' },
  { code: 'SPECIAL_COURSE_GUIDE', name: 'คู่มือการเรียนรายวิชาพิเศษ', category: 'เอกสารและบริการการศึกษา' },
  { code: 'WIFI_GUIDE', name: 'คู่มือการใช้งานเครือข่าย Wi-Fi', category: 'ระบบและบริการดิจิทัล' },
  { code: 'YRU_PASSPORT_GUIDE', name: 'คู่มือการใช้งาน YRU Passport', category: 'ระบบและบริการดิจิทัล' },
  { code: 'MICROSOFT_365_GUIDE', name: 'คู่มือการใช้งาน Microsoft 365', category: 'ระบบและบริการดิจิทัล' },
  { code: 'LIBRARY_GUIDE', name: 'คู่มือการใช้บริการห้องสมุด', category: 'ระบบและบริการดิจิทัล' },
  { code: 'STUDENT_ACTIVITY_RULE', name: 'ข้อกำหนดกิจกรรมนักศึกษา', category: 'กิจกรรมนักศึกษา' },
  { code: 'VOLUNTEER_ACTIVITY_RULE', name: 'ข้อกำหนดกิจกรรมจิตอาสา', category: 'กิจกรรมนักศึกษา' },
  { code: 'DORMITORY_RULE', name: 'ระเบียบหอพักนักศึกษา', category: 'หอพักนักศึกษา' },
];

export function getInitialDocumentFamilies(): InitialDocumentFamily[] {
  return initialDocumentFamilies.map((family) => ({ ...family }));
}
