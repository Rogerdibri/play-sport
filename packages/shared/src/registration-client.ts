import {
  isRegistrationFamily, isMinorRegistrationDraft, registrationAge, registrationIdentification, validateRegistrationContact, validateAdultRegistration, validateMinorRegistration,
  type AdultRegistration, type MinorRegistration, type RegistrationFamily
} from './registration.js';
import { isPreRegistrationDraft, type PreRegistration } from './roster.js';

type RegistrationStorage = {
  getItem: (_key: string) => Promise<string | null>; // eslint-disable-line no-unused-vars
  setItem: (_key: string, _value: string) => Promise<void>; // eslint-disable-line no-unused-vars
};
export class RegistrationClient {
  private access: Promise<string> | null = null;
  private pendingDraft: Promise<unknown> = Promise.resolve();
  private readonly base: string;
  private readonly accountId: string;
  private readonly storage: RegistrationStorage;
  constructor(base: string, accountId: string, storage: RegistrationStorage) {
    this.base = base;
    this.accountId = accountId;
    this.storage = storage;
  }
  private storageKey(kind: string) { return `playsport:demo-registration:${kind}:${this.accountId}`; }
  private async request(path: string, key?: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.base.replace(/\/$/, '')}/registration/${path}`, {
      credentials: 'include',
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      const message = value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ? value.message : `Error ${response.status} al consultar el registro.`;
      throw new Error(message);
    }
    return value;
  }
  accessKey(): Promise<string> {
    if (!this.access) {
      this.access = (async () => {
        const stored = await this.storage.getItem(this.storageKey('access'));
        if (stored !== null) {
          if (!/^[a-f0-9]{64}$/.test(stored)) throw new Error('El acceso familiar guardado es inválido. No se reemplazó.');
          return stored;
        }
        const value = await this.request('access', undefined, {});
        if (!value || typeof value !== 'object' || !('key' in value) || typeof value.key !== 'string' || !/^[a-f0-9]{64}$/.test(value.key)) {
          throw new Error('La API no confirmó el acceso familiar.');
        }
        await this.storage.setItem(this.storageKey('access'), value.key);
        return value.key;
      })().catch(error => { this.access = null; throw error; });
    }
    return this.access;
  }
  private async family(path: string, body?: unknown): Promise<RegistrationFamily> {
    const value = await this.request(path, await this.accessKey(), body);
    if (!isRegistrationFamily(value)) throw new Error('La API devolvió un registro familiar inválido. No se sustituyeron los datos.');
    return value;
  }
  load() { return this.family('family'); }
  saveAdult(profile: AdultRegistration) { return this.family('adult', validateAdultRegistration(profile)); }
  addMinor(profile: MinorRegistration) { return this.family('children', validateMinorRegistration(profile)); }
  addDocument(childId: string, identification: string) { return this.family(`children/${encodeURIComponent(childId)}/document`, { identification }); }
  async inviteTransfer(childId: string, identification: string): Promise<string> {
    const value = await this.request(`children/${encodeURIComponent(childId)}/transfer`, await this.accessKey(), { identification });
    if (!value || typeof value !== 'object' || !('invitation' in value) || typeof value.invitation !== 'string' || !/^[a-f0-9]{64}$/.test(value.invitation)) {
      throw new Error('La API no confirmó la invitación.');
    }
    return value.invitation;
  }
  acceptTransfer(invitation: string, relationship: MinorRegistration['relationship'], consent: boolean) {
    return this.family('transfers/accept', { invitation, relationship, consent });
  }
  async recoverPreRegistration(invitation: string): Promise<PreRegistration & { isMinor: boolean }> {
    const value = await this.request('preinscriptions/recover', await this.accessKey(), { invitation });
    if (!isPreRegistrationDraft(value)) throw new Error('La API devolvió una preinscripción inválida. No se sustituyeron los datos.');
    if (value.fullName.length > 120 || value.fullName.trim().split(/\s+/).length < 2) throw new Error('La preinscripción contiene un nombre inválido.');
    const isMinor = registrationAge(value.birthDate) < 18;
    return { ...value, identification: value.identification ? registrationIdentification(value.identification) : '',
      representativeIdentification: isMinor ? registrationIdentification(value.representativeIdentification) : value.representativeIdentification,
      ...validateRegistrationContact(value.email, value.phone), isMinor };
  }
  async readDraft(): Promise<MinorRegistration | null> {
    await this.pendingDraft;
    const raw = await this.storage.getItem(this.storageKey('draft'));
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (!isMinorRegistrationDraft(value)) throw new Error('El borrador del menor es inválido. No se borró ni reemplazó.');
    return value;
  }
  draft(profile: MinorRegistration): Promise<void> {
    const write = async () => {
      if (!isMinorRegistrationDraft(profile)) throw new Error('El borrador del menor contiene datos inválidos.');
      await this.storage.setItem(this.storageKey('draft'), JSON.stringify(profile));
    };
    const task = this.pendingDraft.then(write, write);
    this.pendingDraft = task;
    return task;
  }
}
