import Link from 'next/link';

export const accountSections = [
  { id: 'profile', title: 'Mi perfil', href: '/profile', description: 'Tus datos personales, identidad y foto.', icon: 'M20 21v-2a7 7 0 0 0-14 0v2M17 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z' },
  { id: 'sports', title: 'Mi hoja deportiva', href: '/sports-sheet', description: 'Tus equipos, trayectoria y estadísticas según tu acceso.', icon: 'M5 3h14v18H5ZM9 8h6m-6 4h6m-6 4h4' },
  { id: 'wallet', title: 'Mi billetera', href: '/wallet', description: 'Un solo saldo y tus movimientos en PlaySport.', icon: 'M20 8V5H4v15h16V8H4m16 4h-5v4h5m-2-2h.01' },
  { id: 'security', title: 'Seguridad', href: '/account/security', description: 'Tu contraseña, sesión y estado de verificación.', icon: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6ZM9 12l2 2 4-4' },
] as const;

export function accountSectionForPath(pathname: string) {
  if (['/sports-sheet/statistics', '/sports-sheet/career', '/sports-sheet/example'].includes(pathname)) return accountSections[1];
  return accountSections.find(section => section.href === pathname);
}

export default function AccountNavigation({ pathname }: { pathname: string }) {
  const section = accountSectionForPath(pathname);
  if (!section) return null;
  return <nav className="accountBreadcrumb" aria-label="Secciones de Mi cuenta">
    <Link href="/account">Mi cuenta</Link><span aria-hidden="true">/</span><span aria-current="page">{section.title}</span>
  </nav>;
}
