import {z} from 'zod';

/**
 * CHAT-MEDIA-02F: the Student-facing link to a confirmed Staff file. It is a fixed LIFF viewer URL that
 * carries only the attachment UUID; the 02G viewer must verify the LIFF ID token (02A/02B) and the SENT
 * delivery before any byte is returned. A LIFF ID is `<LINE Login channel ID>-<suffix>`, so requiring
 * the same channel as the verified Student Login channel keeps the link on the gated viewer app.
 */
export type StudentMediaLinkConfig={liffId:string};
const liffIdPattern=/^(\d{10})-[A-Za-z0-9]{8}$/u;

export function readStudentMediaLinkConfig(env:Record<string,string|undefined>=process.env):StudentMediaLinkConfig|null{
 if(env.LINE_STUDENT_MEDIA_VIEWER_ENABLED!=='true'||env.LINE_STUDENT_LOGIN_SAME_PROVIDER_CONFIRMED!=='true')return null;
 const channelId=env.LINE_STUDENT_LOGIN_CHANNEL_ID,liffId=env.LINE_STUDENT_LIFF_ID??'';
 const match=liffIdPattern.exec(liffId);
 if(!match||!channelId||match[1]!==channelId)return null;
 return {liffId};
}

export function studentMediaViewerUrl(liffId:string,attachmentId:string):string{
 if(!liffIdPattern.test(liffId)||!z.uuid().safeParse(attachmentId).success)throw new Error('STUDENT_MEDIA_LINK_INVALID');
 return `https://liff.line.me/${liffId}?attachment=${attachmentId}`;
}

/** Text only: no file name, object path or Storage host reaches LINE. */
export function staffAttachmentMessageText(mimeType:'application/pdf'|'image/jpeg'|'image/png',url:string):string{
 const kind=mimeType==='application/pdf'?'ไฟล์ PDF':'รูปภาพ';
 return `เจ้าหน้าที่ส่ง${kind}ให้คุณ แตะเพื่อเปิดดู\n${url}\nลิงก์นี้เปิดได้เฉพาะบัญชี LINE ของคุณ`;
}
