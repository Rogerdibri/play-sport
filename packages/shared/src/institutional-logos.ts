export type InstitutionKind = 'team' | 'tournament' | 'league';
export type InstitutionLogo = { kind: InstitutionKind; id: string; name: string; revision: number; hasLogo: boolean };
export type InstitutionLogoChange = {
  requestId: string;
  expectedAccountId: string;
  expectedRevision: number;
  role: 'manager' | 'organizer';
  actorId: string;
  kind: InstitutionKind;
  id: string;
  logo: string;
};
export const institutionLogoMaxLength = 90000;
export const institutionLogosChangedEvent = 'playsport:institution-logos-changed';
export const institutionLogosChangedKey = 'playsport:institution-logos-changed:v1';
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 200 &&
  value === value.trim() &&
  ![...value].some((character) => character.charCodeAt(0) < 32);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const institutionLogoKey = (kind: InstitutionKind, id: string) => `${kind}:${id}`;
export function readInstitutionKind(value: unknown): InstitutionKind {
  if (value !== 'team' && value !== 'tournament' && value !== 'league')
    throw new Error('La identidad debe ser un equipo, un torneo o una liga.');
  return value;
}
export function readInstitutionId(value: unknown): string {
  if (!text(value)) throw new Error('El identificador institucional no es válido.');
  return value;
}
export function readInstitutionLogos(value: unknown): InstitutionLogo[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('La lista de logos no es válida.');
  const keys = new Set<string>();
  return value.map((row) => {
    if (
      !record(row) ||
      !text(row.id) ||
      !text(row.name) ||
      typeof row.revision !== 'number' ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 0 ||
      typeof row.hasLogo !== 'boolean' ||
      (row.hasLogo && row.revision < 1)
    )
      throw new Error('La identidad visual contiene datos inválidos.');
    const kind = readInstitutionKind(row.kind),
      key = institutionLogoKey(kind, row.id);
    if (keys.has(key)) throw new Error('La identidad visual está duplicada.');
    keys.add(key);
    return { kind, id: row.id, name: row.name, revision: row.revision, hasLogo: row.hasLogo };
  });
}
export function readInstitutionLogoChange(value: unknown): InstitutionLogoChange {
  const fields = ['requestId', 'expectedAccountId', 'expectedRevision', 'role', 'actorId', 'kind', 'id', 'logo'];
  if (
    !record(value) ||
    Object.keys(value).some((key) => !fields.includes(key)) ||
    !uuid(value.requestId) ||
    !uuid(value.expectedAccountId) ||
    typeof value.expectedRevision !== 'number' ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0 ||
    value.expectedRevision >= Number.MAX_SAFE_INTEGER ||
    (value.role !== 'manager' && value.role !== 'organizer') ||
    !text(value.actorId) ||
    typeof value.logo !== 'string' ||
    value.logo.length > institutionLogoMaxLength ||
    (value.logo !== '' && !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.logo))
  ) {
    throw new Error('La solicitud de logo no es válida.');
  }
  return {
    requestId: value.requestId,
    expectedAccountId: value.expectedAccountId,
    expectedRevision: value.expectedRevision,
    role: value.role,
    actorId: value.actorId,
    kind: readInstitutionKind(value.kind),
    id: readInstitutionId(value.id),
    logo: value.logo
  };
}
