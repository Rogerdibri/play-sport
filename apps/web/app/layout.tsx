import './globals.css';
import type { ReactNode } from 'react';
import PlatformSession from './platform-session';
import InstitutionalLogos from './institutional-logos';
import PlayerSportsProvider from './player-sports-context';
import { InstitutionLogoEditing } from './institution-logo-editor';
import FavoritesProvider from './favorites';

export const metadata = { title: 'PlaySport', description: 'Deporte conectado' };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="es"><body><InstitutionalLogos><PlatformSession><FavoritesProvider><InstitutionLogoEditing><PlayerSportsProvider>{children}</PlayerSportsProvider></InstitutionLogoEditing></FavoritesProvider></PlatformSession></InstitutionalLogos></body></html>;
}
