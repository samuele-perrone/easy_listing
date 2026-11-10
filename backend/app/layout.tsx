import type { Metadata } from 'next';
import { APP_STORE_ID } from '@/lib/appStore';

export const metadata: Metadata = {
  title: 'Easy Listing',
  // Safari on iPhone shows its native "Open / Get" banner for the app.
  itunes: { appId: APP_STORE_ID },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
