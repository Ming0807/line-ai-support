import Link from 'next/link';
export default function TicketNotFound(){
 return <main className="ticket-page"><h1>ไม่พบเรื่องที่เข้าถึงได้</h1><p>กรุณากลับไปเลือกเรื่องจากคิวงานของคุณ</p><Link href="/tickets">กลับไปงานรับเรื่อง</Link></main>;
}
