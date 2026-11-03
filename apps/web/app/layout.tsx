import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'PlaySport', description: 'Deporte conectado' };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
