export function webApplicationOrigin(configured: string | undefined, developmentHost: string | undefined, development: boolean): string {
  if (!configured && !development) throw new Error('Configura EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN para publicar la app.');
  const host = !configured && developmentHost ? new URL(`http://${developmentHost}`).hostname : 'localhost';
  const value = new URL(configured ?? `http://${host}:3000`);
  if (!['http:', 'https:'].includes(value.protocol) || !development && value.protocol !== 'https:' ||
      value.username || value.password || value.pathname !== '/' || value.search || value.hash)
    throw new Error('La dirección web de PlaySport debe ser un origen válido, con HTTPS fuera de desarrollo.');
  return value.origin;
}
