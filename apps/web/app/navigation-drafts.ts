export const isTextDraft = (value: unknown): value is string => typeof value === 'string';
export const isStringListDraft = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isTextDraft);
export const isTextMapDraft = (value: unknown): value is Record<string, string> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(isTextDraft);

export function isChoiceDraft<T extends string>(choices: readonly T[]) {
  return (value: unknown): value is T => typeof value === 'string' && choices.some((choice) => choice === value);
}

// eslint-disable-next-line no-unused-vars -- Type-only predicate parameter.
export function readNavigationDraft<T>(raw: string | null, initial: T, valid: (value: unknown) => value is T): T {
  if (raw === null) return initial;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1 ||
      !('value' in parsed) || !valid(parsed.value)) {
    throw new Error('El borrador guardado contiene datos inválidos. No se aplicó al partido.');
  }
  return parsed.value;
}

export function normalizeAppRoutes(routes: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const route of routes) {
    const destination = route.split(/[?#]/)[0] === '/demo/player-career' ? '/sports-sheet' : route;
    if (normalized.at(-1) !== destination) normalized.push(destination);
  }
  return normalized;
}

export function previousAppRoute(routes: readonly string[]): string {
  return routes.length > 1 ? routes[routes.length - 2] : '/';
}
