import { ForbiddenException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

export function accountCookieName() {
  return process.env.NODE_ENV === 'production' ? '__Host-playsport-account' : 'playsport-account';
}
export function accountToken(request: IncomingMessage): string | undefined {
  const name = accountCookieName();
  const matches = (request.headers.cookie ?? '').split(';').map(value => value.trim())
    .filter(value => value.startsWith(`${name}=`));
  if (matches.length > 1) throw new ForbiddenException('La cookie de acceso no es válida.');
  return matches[0]?.slice(name.length + 1);
}
export function accountWebOrigins(): string[] {
  const configured = [process.env.PLAYSPORT_WEB_ORIGIN ?? 'http://localhost:3000',
    ...(process.env.PLAYSPORT_ADDITIONAL_WEB_ORIGINS ? process.env.PLAYSPORT_ADDITIONAL_WEB_ORIGINS.split(',') : [])];
  return [...new Set(configured.map(origin => {
    const url = new URL(origin.trim());
    if (!['http:', 'https:'].includes(url.protocol) || process.env.NODE_ENV === 'production' && url.protocol !== 'https:' ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new Error('Configura orígenes web explícitos, con HTTPS para el despliegue.');
    return url.origin;
  }))];
}
export function assertAccountOrigin(request: IncomingMessage) {
  if (!accountWebOrigins().includes(request.headers.origin ?? '')) throw new ForbiddenException('Esta solicitud no proviene del sitio autorizado.');
}
