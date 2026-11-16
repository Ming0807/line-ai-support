import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {readStudentMediaLinkConfig} from '@/lib/chat/student-media-link';
import {StudentMediaViewer} from './viewer';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'ไฟล์จากเจ้าหน้าที่',referrer:'no-referrer',robots:{index:false,follow:false}};

/** CHAT-MEDIA-02G LIFF endpoint. Hidden unless the Student viewer gates and LIFF ID are configured. */
export default function StudentMediaPage(){
 const config=readStudentMediaLinkConfig(process.env);
 if(!config||!process.env.ENCRYPTION_KEY)notFound();
 return <StudentMediaViewer liffId={config.liffId}/>;
}
