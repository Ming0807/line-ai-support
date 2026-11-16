import {studentMediaSessionHandler} from '@/lib/chat/student-media-viewer-api';
export const runtime='nodejs';
export async function POST(request:Request){return studentMediaSessionHandler(request);}
