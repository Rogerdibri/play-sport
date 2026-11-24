import { isProfileLocation, type ProfileLocation } from './venezuela.js';
import { normalizeProfileIdentification, validateAdultRegistration } from './registration.js';
export { normalizeProfileIdentification } from './registration.js';

export const demoProfilesKey = 'playsport:demo-personal-profiles:v1';
export const profilePhotoMaxLength = 280000;
export const socialNetworks = ['instagram', 'facebook', 'tiktok', 'x', 'youtube'] as const;
export type SocialNetwork = typeof socialNetworks[number];
export type DemoPersonalProfile = {
  id: string; accountId: string; identification: string; fullName: string; phone: string; birthDate: string; email: string;
  location: ProfileLocation; address: string; sex: '' | 'female' | 'male' | 'not-specified';
  social: Record<SocialNetwork, string>; photo: string;
};
export type DemoProfiles = { version: 1; saved: DemoPersonalProfile[]; drafts: DemoPersonalProfile[] };
const copyProfile = (profile: DemoPersonalProfile): DemoPersonalProfile => ({
  ...profile, location: { ...profile.location }, social: { ...profile.social }
});
const copyProfiles = (document: DemoProfiles): DemoProfiles => ({
  version: 1, saved: document.saved.map(copyProfile), drafts: document.drafts.map(copyProfile)
});
export function newDemoPersonalProfile(accountId: string, location: ProfileLocation): DemoPersonalProfile {
  return {
    id: `demo-person:${accountId}`, accountId, identification: '', fullName: '', phone: '', birthDate: '', email: '',
    location, address: '', sex: '', social: { instagram: '', facebook: '', tiktok: '', x: '', youtube: '' }, photo: ''
  };
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit;
export function isDemoPersonalProfile(value: unknown): value is DemoPersonalProfile {
  return record(value) && text(value.accountId, 120) && /^[a-zA-Z0-9_-]+$/.test(value.accountId) &&
    value.id === `demo-person:${value.accountId}` && text(value.identification, 20) &&
    text(value.fullName, 120) && text(value.phone, 30) && text(value.birthDate, 10) && text(value.email, 254) &&
    isProfileLocation(value.location) && text(value.address, 300) &&
    typeof value.sex === 'string' && ['', 'female', 'male', 'not-specified'].includes(value.sex) && record(value.social) &&
    socialNetworks.every(network => record(value.social) && text(value.social[network], 500)) &&
    text(value.photo, profilePhotoMaxLength) && (value.photo === '' || /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.photo));
}
const socialHosts: Record<SocialNetwork, string[]> = {
  instagram: ['instagram.com'], facebook: ['facebook.com', 'fb.com'], tiktok: ['tiktok.com'],
  x: ['x.com', 'twitter.com'], youtube: ['youtube.com', 'youtu.be']
};
export function profileSocialUrl(network: SocialNetwork, value: string): string {
  if (!value.trim()) return '';
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(`Introduce un enlace completo https:// para ${network}.`); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !socialHosts[network].some(domain => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error(`El enlace de ${network} debe ser https:// y pertenecer a esa red social.`);
  }
  return url.href;
}
function validateSaved(profile: DemoPersonalProfile, requireRegistration = false): DemoPersonalProfile {
  const identification = normalizeProfileIdentification(profile.identification);
  if (!/^[VE]-[1-9]\d{0,8}$/.test(identification)) throw new Error('Introduce una cédula válida, por ejemplo V-12345678 o E-12345678.');
  if (profile.fullName.trim().split(/\s+/).length < 2) throw new Error('Introduce nombre y apellido.');
  const phone = profile.phone.trim();
  if (phone && (!/^\+?[\d ()-]+$/.test(phone) || !/^\d{7,15}$/.test(phone.replace(/\D/g, '')))) {
    throw new Error('Revisa el teléfono: debe contener entre 7 y 15 dígitos.');
  }
  const social = { ...profile.social };
  for (const network of socialNetworks) social[network] = profileSocialUrl(network, social[network]);
  const registration = requireRegistration ? validateAdultRegistration({ ...profile, identification }) : null;
  return { ...profile, ...registration, identification, fullName: profile.fullName.trim(), phone, address: profile.address.trim(), social };
}
export function readDemoProfiles(raw: string | null): DemoProfiles {
  if (raw === null) return { version: 1, saved: [], drafts: [] };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('No se pueden leer los perfiles del dispositivo. No se borraron ni reemplazaron.'); }
  if (record(value) && value.version === 1 && Array.isArray(value.saved) && Array.isArray(value.drafts)) {
    const migrate = (profile: unknown) => record(profile) ? { birthDate: '', email: '', ...profile } : profile;
    value.saved = value.saved.map(migrate);
    value.drafts = value.drafts.map(migrate);
  }
  if (!record(value) || value.version !== 1 || !Array.isArray(value.saved) || !Array.isArray(value.drafts) ||
      !value.saved.every(isDemoPersonalProfile) || !value.drafts.every(isDemoPersonalProfile) ||
      new Set(value.saved.map(profile => profile.accountId)).size !== value.saved.length ||
      new Set(value.drafts.map(profile => profile.accountId)).size !== value.drafts.length) {
    throw new Error('El archivo de perfiles contiene datos inválidos. Se conservó sin sobrescribir.');
  }
  const saved = value.saved.map(profile => validateSaved(profile));
  if (new Set(saved.map(profile => profile.identification)).size !== saved.length ||
      value.drafts.some(draft => saved.some(profile => profile.accountId === draft.accountId && profile.identification !== normalizeProfileIdentification(draft.identification)))) {
    throw new Error('Los perfiles contienen cédulas duplicadas o modificadas. No se sobrescribió el archivo.');
  }
  return { version: 1, saved, drafts: value.drafts };
}
type ProfileStorage = {
  getItem: (_key: string) => Promise<string | null>; // eslint-disable-line no-unused-vars
  setItem: (_key: string, _value: string) => Promise<void>; // eslint-disable-line no-unused-vars
};
export class DemoProfileStore {
  private document: DemoProfiles | null = null;
  private pending: Promise<unknown> = Promise.resolve();
  private readonly storage: ProfileStorage;
  constructor(storage: ProfileStorage) { this.storage = storage; }
  load(): Promise<DemoProfiles> {
    const read = async () => {
      this.document = readDemoProfiles(await this.storage.getItem(demoProfilesKey));
      return copyProfiles(this.document);
    };
    const task = this.pending.then(read, read);
    this.pending = task;
    return task;
  }
  private update(transform: (_document: DemoProfiles) => DemoProfiles): Promise<DemoProfiles> { // eslint-disable-line no-unused-vars
    const write = async () => {
      if (!this.document) throw new Error('Recupera primero los perfiles del dispositivo.');
      const current = readDemoProfiles(await this.storage.getItem(demoProfilesKey));
      const next = transform(current);
      readDemoProfiles(JSON.stringify(next));
      await this.storage.setItem(demoProfilesKey, JSON.stringify(next));
      this.document = next;
      return copyProfiles(next);
    };
    const task = this.pending.then(write, write);
    this.pending = task;
    return task;
  }
  draft(profile: DemoPersonalProfile): Promise<DemoProfiles> {
    return this.update(document => {
      if (!isDemoPersonalProfile(profile)) throw new Error('El borrador del perfil contiene datos inválidos.');
      return { ...document, drafts: [...document.drafts.filter(item => item.accountId !== profile.accountId), copyProfile(profile)] };
    });
  }
  save(accountId: string): Promise<DemoProfiles> {
    return this.update(document => {
      const draft = document.drafts.find(profile => profile.accountId === accountId);
      if (!draft) throw new Error('No hay un borrador de perfil para guardar.');
      const profile = validateSaved(draft, true);
      const previous = document.saved.find(item => item.accountId === accountId);
      if (previous && previous.identification !== profile.identification) throw new Error('La cédula registrada no se puede modificar desde el editor.');
      if (document.saved.some(item => item.accountId !== accountId && item.identification === profile.identification)) {
        throw new Error('Esa cédula de prueba ya pertenece a otra cuenta en este dispositivo.');
      }
      return { version: 1, saved: [...document.saved.filter(item => item.accountId !== accountId), profile],
        drafts: [...document.drafts.filter(item => item.accountId !== accountId), profile] };
    });
  }
}
