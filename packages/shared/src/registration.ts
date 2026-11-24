import { isProfileLocation, type ProfileLocation } from './venezuela.js';

export function normalizeProfileIdentification(value: string): string {
  return value.trim().toUpperCase().replace(/^([VE])\s*-?\s*0*(\d+)$/, '$1-$2');
}

export type AdultRegistration = {
  identification: string;
  fullName: string;
  birthDate: string;
  email: string;
  phone?: string;
  location: ProfileLocation;
};
export type MinorRegistration = {
  identification: string;
  fullName: string;
  birthDate: string;
  location: ProfileLocation;
  relationship: 'father' | 'mother' | 'guardian';
  consent: boolean;
};
export type RegisteredMinor = MinorRegistration & {
  id: string;
  registrationNumber: string;
  registrationAliases: string[];
  representativeId: string;
};
export type RegistrationFamily = {
  id: string;
  adult: (AdultRegistration & { id: string }) | null;
  children: RegisteredMinor[];
};
export function isRegistrationFamily(value: unknown): value is RegistrationFamily {
  const record = (input: unknown): input is Record<string, unknown> => Boolean(input && typeof input === 'object' && !Array.isArray(input));
  const id = (input: unknown): input is string => typeof input === 'string' && /^PERSON[A-F0-9]{32}$/.test(input);
  const identification = (input: unknown): input is string => typeof input === 'string' && /^[VE]-[1-9]\d{0,8}$/.test(input);
  const code = (input: unknown): input is string => identification(input) || (typeof input === 'string' && /^[VE]-[1-9]\d{0,8}-[1-9]\d*$/.test(input));
  const person = (input: unknown): input is Record<string, unknown> => record(input) && id(input.id) &&
    typeof input.fullName === 'string' && input.fullName.length <= 120 && input.fullName.trim().split(/\s+/).length >= 2 &&
    typeof input.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) && isProfileLocation(input.location);
  return record(value) && id(value.id) && (value.adult === null || (person(value.adult) && value.adult.id === value.id &&
    identification(value.adult.identification) && typeof value.adult.email === 'string' && value.adult.email.length <= 254 &&
    (value.adult.phone === undefined || typeof value.adult.phone === 'string' && value.adult.phone.length <= 30))) &&
    Array.isArray(value.children) && value.children.every(child => person(child) && (child.identification === '' || identification(child.identification)) &&
      code(child.registrationNumber) && Array.isArray(child.registrationAliases) && child.registrationAliases.every(code) &&
      child.representativeId === value.id && ['father', 'mother', 'guardian'].includes(String(child.relationship)) && child.consent === true) &&
    (value.adult !== null || value.children.length === 0);
}
export function isMinorRegistrationDraft(value: unknown): value is MinorRegistration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return 'identification' in value && typeof value.identification === 'string' && value.identification.length <= 20 &&
    'fullName' in value && typeof value.fullName === 'string' && value.fullName.length <= 120 &&
    'birthDate' in value && typeof value.birthDate === 'string' && value.birthDate.length <= 10 &&
    'location' in value && isProfileLocation(value.location) && 'relationship' in value && typeof value.relationship === 'string' &&
    ['father', 'mother', 'guardian'].includes(value.relationship) && 'consent' in value && typeof value.consent === 'boolean';
}
export function registrationIdentification(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Introduce una cédula válida.');
  const identification = normalizeProfileIdentification(value);
  if (!/^[VE]-[1-9]\d{0,8}$/.test(identification)) throw new Error('Introduce una cédula válida, por ejemplo V-12345678.');
  return identification;
}
export function registrationAge(value: unknown, today = new Date()): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('La fecha de nacimiento es obligatoria. Usa AAAA-MM-DD.');
  const date = new Date(`${value}T00:00:00Z`);
  const current = today.toISOString().slice(0, 10);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value > current || value < '1900-01-01') {
    throw new Error('Revisa la fecha de nacimiento: debe ser una fecha real, no futura.');
  }
  return Number(current.slice(0, 4)) - Number(value.slice(0, 4)) - (current.slice(5) < value.slice(5) ? 1 : 0);
}
function registrationName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 120 || value.trim().split(/\s+/).length < 2) throw new Error('Introduce nombre y apellido.');
  return value.trim().replace(/\s+/g, ' ');
}
export function validateRegistrationContact(email: unknown, phone: unknown): { email: string; phone: string } {
  if (typeof email !== 'string' || (phone !== undefined && typeof phone !== 'string')) throw new Error('Introduce correo o teléfono válidos.');
  const normalizedEmail = email.trim().toLowerCase(), normalizedPhone = typeof phone === 'string' ? phone.trim() : '';
  if (!normalizedEmail && !normalizedPhone) throw new Error('Introduce al menos un contacto: correo electrónico o teléfono.');
  if (normalizedEmail && (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))) throw new Error('Introduce un correo electrónico válido.');
  if (normalizedPhone && (normalizedPhone.length > 30 || !/^\+?[\d ()-]+$/.test(normalizedPhone) || !/^\d{7,15}$/.test(normalizedPhone.replace(/\D/g, '')))) {
    throw new Error('Revisa el teléfono: debe contener entre 7 y 15 dígitos.');
  }
  return { email: normalizedEmail, phone: normalizedPhone };
}
export function validateAdultRegistration(value: AdultRegistration, today = new Date()): AdultRegistration {
  if (!value || typeof value !== 'object') throw new Error('Los datos del representante son obligatorios.');
  const identification = registrationIdentification(value.identification);
  const fullName = registrationName(value.fullName);
  if (registrationAge(value.birthDate, today) < 18) throw new Error('La cuenta responsable debe pertenecer a un adulto. Registra al menor mediante su representante.');
  const contact = validateRegistrationContact(value.email, value.phone);
  if (!isProfileLocation(value.location)) throw new Error('Selecciona un estado y municipio válidos.');
  return { identification, fullName, birthDate: value.birthDate, ...contact, location: { ...value.location } };
}
export function validateMinorRegistration(value: MinorRegistration, today = new Date()): MinorRegistration {
  if (!value || typeof value !== 'object') throw new Error('Los datos del menor son obligatorios.');
  const fullName = registrationName(value.fullName);
  if (registrationAge(value.birthDate, today) >= 18) throw new Error('Este formulario es para menores de 18 años.');
  if (!isProfileLocation(value.location)) throw new Error('Selecciona un estado y municipio válidos.');
  if (!['father', 'mother', 'guardian'].includes(value.relationship)) throw new Error('Indica tu relación con el menor.');
  if (value.consent !== true) throw new Error('Debes declarar que tienes autorización para representar al menor.');
  const identification = value.identification === '' ? '' : registrationIdentification(value.identification);
  return { identification, fullName, birthDate: value.birthDate, location: { ...value.location }, relationship: value.relationship, consent: true };
}
export function newMinorRegistration(location: ProfileLocation): MinorRegistration {
  return { identification: '', fullName: '', birthDate: '', location: { ...location }, relationship: 'guardian', consent: false };
}
export function matchingFamilyChildren(family: RegistrationFamily, query: string): RegisteredMinor[] {
  const key = normalizeProfileIdentification(query).toLocaleUpperCase('es').replace(/\s/g, '');
  if (!key || family.adult?.identification === normalizeProfileIdentification(query)) return family.children;
  return family.children.filter(child =>
    [child.fullName, child.id, child.registrationNumber, child.identification, ...child.registrationAliases]
      .some(value => normalizeProfileIdentification(value).toLocaleUpperCase('es').replace(/\s/g, '').includes(key)));
}
