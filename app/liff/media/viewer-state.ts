/** CHAT-MEDIA-02G LIFF viewer helpers (pure, client-safe). */
const lowerUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Read only after liff.init() resolved the `liff.state` redirect into the real query. */
export function readAttachmentParam(search:string):string|null{
 const value=new URLSearchParams(search).get('attachment');
 return value&&lowerUuid.test(value)?value:null;
}

/** 403 and 404 share one message so the page never reveals whether the file belongs to someone else. */
export function viewerMessageFor(status:number):string{
 if(status===401)return 'ยืนยันบัญชี LINE ไม่สำเร็จ กรุณาปิดหน้านี้แล้วแตะลิงก์ในแชตอีกครั้ง';
 if(status===403||status===404)return 'ไม่พบไฟล์นี้สำหรับบัญชี LINE ของคุณ ไฟล์อาจหมดเวลาเปิดดูหรือถูกยกเลิกแล้ว กรุณาติดต่อเจ้าหน้าที่ในแชต';
 return 'ระบบยังเปิดไฟล์ไม่ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง';
}
