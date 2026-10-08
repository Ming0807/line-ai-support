import type { Metadata } from 'next';
import './globals.css';
import './operations-metrics.css';

export const metadata: Metadata = {
  title: 'ระบบงานบริการบุคลากร มหาวิทยาลัยราชภัฏยะลา',
  description: 'ระบบรับเรื่องและติดตามงานบริการสำหรับบุคลากร',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
