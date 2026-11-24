import { readPersonIdentity, type PersonIdentity } from './person-identity.js';
import { isAccessFeature, type AccessFeature } from './account-access.js';
export type AccountProfile = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  emailVerified: false;
  identityVerification: 'unavailable' | 'manual';
  financialAccess: false;
  localTestAccess?: true;
  photo?: string;
  photoRevision?: number;
  identity?: PersonIdentity;
  identityReviewer?: true;
  administrationAccess?: true;
  features?: AccessFeature[];
};
export const accountChangedEvent = 'playsport:account-changed';
export const accountChangedKey = 'playsport:account-changed:v1';
export const accountPhotoChangedEvent = 'playsport:account-photo-changed';
export const accountPhotoChangedKey = 'playsport:account-photo-changed:v1';
export const accountPhotoMaxLength = 90000;
export const passwordPolicyHint = 'Usa de 8 a 128 caracteres con al menos una mayúscula, un número y un carácter especial (por ejemplo ! @ # $ % - _ . o un espacio).';
export function passwordPolicyProblem(value: string): string | null {
  const length = [...value].length;
  if (length < 8 || length > 128) return 'La contraseña debe tener de 8 a 128 caracteres.';
  if (!/\p{Lu}/u.test(value)) return 'La contraseña debe tener al menos una letra mayúscula.';
  if (!/\p{N}/u.test(value)) return 'La contraseña debe tener al menos un número.';
  if (!/[^\p{L}\p{N}]/u.test(value)) return 'La contraseña debe tener al menos un carácter especial, por ejemplo ! @ # $ % - _ . o un espacio.';
  return null;
}
export type AccountPhotoChange = { requestId: string; expectedAccountId: string; expectedRevision: number; photo: string };
export function readAccountPhoto(value: unknown): string {
  if (typeof value !== 'string' || value.length > accountPhotoMaxLength ||
    value !== '' && !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('La foto de cuenta debe ser un JPEG preparado de hasta 90.000 caracteres.');
  return value;
}
export function readAccountPhotoChange(value: unknown): AccountPhotoChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La actualización de foto no es válida.');
  const fields = Object.fromEntries(Object.entries(value));
  if (Object.keys(fields).some(key => !['requestId', 'expectedAccountId', 'expectedRevision', 'photo'].includes(key)) ||
    typeof fields.requestId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(fields.requestId) ||
    typeof fields.expectedAccountId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(fields.expectedAccountId) ||
    typeof fields.expectedRevision !== 'number' || !Number.isSafeInteger(fields.expectedRevision) || fields.expectedRevision < 0 || fields.expectedRevision >= Number.MAX_SAFE_INTEGER) throw new Error('La cuenta, revisión o clave de actualización de foto no son válidas.');
  return { requestId: fields.requestId, expectedAccountId: fields.expectedAccountId, expectedRevision: fields.expectedRevision, photo: readAccountPhoto(fields.photo) };
}

export function readAccountProfile(value: unknown): AccountProfile {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.id) || !('email' in value) || typeof value.email !== 'string' ||
      !('displayName' in value) || typeof value.displayName !== 'string' || !value.displayName ||
      !('createdAt' in value) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
      !('emailVerified' in value) || value.emailVerified !== false ||
      !('identityVerification' in value) || !['unavailable', 'manual'].includes(String(value.identityVerification)) ||
      !('financialAccess' in value) || value.financialAccess !== false ||
      'localTestAccess' in value && value.localTestAccess !== true ||
      'identityReviewer' in value && value.identityReviewer !== true ||
      'administrationAccess' in value && value.administrationAccess !== true ||
      'features' in value && (!Array.isArray(value.features) || !value.features.every(isAccessFeature)) ||
      ('photo' in value) !== ('photoRevision' in value) ||
      'photoRevision' in value && (typeof value.photoRevision !== 'number' || !Number.isSafeInteger(value.photoRevision) || value.photoRevision < 1)) {
    throw new Error('La cuenta recibida contiene datos inválidos.');
  }
  return { id: value.id, email: value.email, displayName: value.displayName, createdAt: value.createdAt,
    emailVerified: false, identityVerification: value.identityVerification as AccountProfile['identityVerification'], financialAccess: false,
    ...('localTestAccess' in value ? { localTestAccess: true as const } : {}),
    ...('identity' in value ? { identity: readPersonIdentity(value.identity) } : {}),
    ...('identityReviewer' in value ? { identityReviewer: true as const } : {}),
    ...('administrationAccess' in value ? { administrationAccess: true as const } : {}),
    ...('features' in value && Array.isArray(value.features) && value.features.every(isAccessFeature) ? { features: value.features } : {}),
    ...('photo' in value && 'photoRevision' in value && typeof value.photoRevision === 'number' ? { photo: readAccountPhoto(value.photo), photoRevision: value.photoRevision } : {}) };
}
