'use client';

import Link from 'next/link';
import { accountSectionForPath } from './account-navigation';

const items = [
  { id: 'home', label: 'Inicio', path: '/', icon: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z' },
  { id: 'profile', label: 'Mi cuenta', path: '/account', icon: 'M20 21v-2a7 7 0 0 0-14 0v2M17 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z' },
  { id: 'roles', label: 'Elegir rol', path: '/', icon: 'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4' },
  { id: 'marketplace', label: 'Marketplace', path: '/demo/marketplace', icon: 'M4 9h16v12H4ZM3 9l2-6h14l2 6M9 21v-7h6v7M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0' },
  { id: 'events', label: 'Cartelera', path: '/demo/events-map', icon: 'M4 5h16v16H4ZM8 3v4m8-4v4M4 11h16M8 15h2m4 0h2m-8 3h2' },
] as const;

export default function MobileBottomNavigation({ pathname, hasRole, disabled, onWelcome }: {
  pathname: string; hasRole: boolean; disabled: boolean; onWelcome: () => void;
}) {
  const active = pathname === '/' ? hasRole ? 'home' : 'roles'
    : pathname === '/account' || accountSectionForPath(pathname) ? 'profile'
    : items.find(item => item.path !== '/' && pathname.startsWith(item.path))?.id;
  return <nav className="mobileBottomNavigation" aria-label="Navegación inferior">
    {items.map(item => {
      const content = <><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.icon} /></svg><span>{item.label}</span></>;
      return item.path === '/' ? <button key={item.id} type="button" disabled={disabled}
        aria-current={active === item.id ? 'page' : undefined} onClick={onWelcome}>{content}</button>
        : <Link key={item.id} href={item.path} aria-disabled={disabled || undefined}
          aria-current={active === item.id ? 'page' : undefined} tabIndex={disabled ? -1 : undefined}>{content}</Link>;
    })}
  </nav>;
}
