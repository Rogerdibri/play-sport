import './globals.css';
import type { ReactNode } from 'react';
import PlatformSession from './platform-session';

export const metadata = { title: 'PlaySport', description: 'Deporte conectado' };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="es"><body><PlatformSession>{children}</PlatformSession></body></html>;
}
