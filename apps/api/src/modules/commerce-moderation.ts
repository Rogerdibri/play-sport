import { existsSync, readFileSync } from 'node:fs';

export function commerceCanModerate(accountId: string | null, path: string): boolean {
  if (!accountId || process.env.NODE_ENV === 'production') return false;
  const origin = new URL(process.env.PLAYSPORT_WEB_ORIGIN ?? 'http://localhost:3000');
  if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || !existsSync(path)) return false;
  const config: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!config || typeof config !== 'object' || !('version' in config) || config.version !== 1 ||
    !('accountIds' in config) || !Array.isArray(config.accountIds) ||
    !config.accountIds.every(id => typeof id === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))) {
    throw new Error('La configuración privada de moderación del Marketplace no es válida.');
  }
  return config.accountIds.includes(accountId);
}
