import { registrationAge, registrationIdentification } from './registration.js';

export type PersonIdentity = {
  identification: string;
  fullName: string;
  birthDate: string;
  status: 'pending' | 'verified' | 'rejected';
  revision: number;
  reason: string;
  actorId?: string;
};
export const identityImageMaxLength = 420000;
export function readPersonIdentity(value: unknown): PersonIdentity {
  if (
    !value ||
    typeof value !== 'object' ||
    !('identification' in value) ||
    typeof value.identification !== 'string' ||
    !('fullName' in value) ||
    typeof value.fullName !== 'string' ||
    value.fullName.trim().split(/\s+/).length < 2 ||
    value.fullName.length > 120 ||
    [...value.fullName].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    !('birthDate' in value) ||
    typeof value.birthDate !== 'string' ||
    !('status' in value) ||
    !['pending', 'verified', 'rejected'].includes(String(value.status)) ||
    !('revision' in value) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !('reason' in value) ||
    typeof value.reason !== 'string' ||
    value.reason.length > 2000
  ) {
    throw new Error('La identidad personal no es válida.');
  }
  registrationAge(value.birthDate);
  if ('actorId' in value && (typeof value.actorId !== 'string' || !/^person:[a-f0-9-]{36}$/.test(value.actorId)))
    throw new Error('El vínculo interno de identidad no es válido.');
  return {
    identification: registrationIdentification(value.identification),
    fullName: value.fullName.trim().replace(/\s+/g, ' '),
    birthDate: value.birthDate,
    status: value.status as PersonIdentity['status'],
    revision: value.revision,
    reason: value.reason,
    ...('actorId' in value && typeof value.actorId === 'string' ? { actorId: value.actorId } : {})
  };
}
