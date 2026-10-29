export const AI_LONG_INPUT_MESSAGE='ได้รับข้อความครบแล้วครับ แต่รายละเอียดเกินขนาดที่ AI วิเคราะห์ได้ในครั้งเดียว กรุณาแยกคำถามเป็นประเด็น หรือเลือกติดต่อเจ้าหน้าที่เพื่อให้ตรวจสอบข้อความทั้งหมดครับ';
export function exceedsAIQuestionLimit(question:string):boolean{
 return question.length>20000||Buffer.byteLength(question,'utf8')>60000;
}
