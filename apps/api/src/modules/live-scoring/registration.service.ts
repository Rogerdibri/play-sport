import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { OfficialStateStore } from './official-state.store';
import {
  registrationIdentification, validateAdultRegistration, validateMinorRegistration, isRegistrationFamily,
  registrationAge, normalizeProfileIdentification, normalizedPersonName, isPreRegistrationDraft, isRosterPerson, isRosterRole, validatePreRegistration,
  type AdultRegistration, type MinorRegistration, type RegisteredMinor, type RegistrationFamily,
  readRosterRules, rosterAdmission, rosterClosure, rosterGroup, rosterGroups,
  type RosterRules, type RosterRuleGame, type RosterRulesView,
  type PreRegistration, type RosterPerson, type RosterMember, type RosterRole, type ManagerRosterTeam
} from '@playsport/shared';

type StoredFamily = RegistrationFamily & { accessHash: string };
type Transfer = { hash: string; childId: string; from: string; to: string; expiresAt: string };
type PreinscribedPerson = PreRegistration & { id: string; createdByManagerId: string; createdAt: string; invitationHash?: string; invitationExpiresAt?: string };
type StoredRosterMember = { tournamentId: string; teamId: string; managerId: string; person: RosterPerson; role: RosterRole };
type StoredRosterRules = { tournamentId: string; organizerId: string; rules: RosterRules; revision: number; closedAt: string | null };
export type RosterRulesContext = { tournamentId: string; tournamentName: string; organizerId: string; games: RosterRuleGame[];
  teamIds: string[]; members: Record<string, RosterMember[]> };
type RosterAddition = { context: RosterRulesContext; validate: (_person: RosterPerson) => void }; // eslint-disable-line no-unused-vars
type RegistryDocument = { version: 1; families: StoredFamily[]; suffixes: Record<string, number>; transfers: Transfer[];
  preinscriptions: PreinscribedPerson[]; rosterMembers: StoredRosterMember[]; rosterRules: StoredRosterRules[] };
const digest = (key: string) => createHash('sha256').update(key).digest('hex');
const personId = () => `PERSON${randomUUID().replace(/-/g, '').toUpperCase()}`;

@Injectable()
export class RegistrationService {
  private readonly path: string;
  private persistentStore?: OfficialStateStore;
  constructor(path?: string, private readonly verifiedLookup?: (_input: string) => RosterPerson | null) { // eslint-disable-line no-unused-vars
    this.path = path ?? resolve(process.env.PLAYSPORT_REGISTRATION_PATH ?? '.local/registration.json');
  }
  private read(): RegistryDocument {
    const stored = this.persistentStore?.registration();
    if (this.persistentStore && stored === null) throw new Error('Falta el registro deportivo persistente.');
    if (stored === undefined && !existsSync(this.path)) return { version: 1, families: [], suffixes: {}, transfers: [], preinscriptions: [], rosterMembers: [], rosterRules: [] };
    const value: unknown = JSON.parse(stored ?? readFileSync(this.path, 'utf8'));
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 ||
        !('families' in value) || !Array.isArray(value.families) ||
        !value.families.every(family => isRegistrationFamily(family) && 'accessHash' in family && typeof family.accessHash === 'string' && /^[a-f0-9]{64}$/.test(family.accessHash)) ||
        !('suffixes' in value) || !value.suffixes || typeof value.suffixes !== 'object' || Array.isArray(value.suffixes) ||
        !Object.entries(value.suffixes).every(([key, next]) => /^[VE]-[1-9]\d{0,8}$/.test(key) && Number.isSafeInteger(next) && Number(next) > 0)) {
      throw new Error('El registro de familias contiene datos inválidos. No se sobrescribió.');
    }
    const families: StoredFamily[] = value.families;
    const preinscriptions: PreinscribedPerson[] = [];
    if ('preinscriptions' in value) {
      if (!Array.isArray(value.preinscriptions)) throw new Error('Las preinscripciones son inválidas. No se sobrescribió el registro.');
      for (const person of value.preinscriptions) {
        if (!isPreRegistrationDraft(person) || !('id' in person) || typeof person.id !== 'string' || !/^PERSON[A-F0-9]{32}$/.test(person.id) ||
            !('createdByManagerId' in person) || typeof person.createdByManagerId !== 'string' || !person.createdByManagerId ||
            !('createdAt' in person) || typeof person.createdAt !== 'string' || !Number.isFinite(Date.parse(person.createdAt))) {
          throw new Error('Una preinscripción es inválida. No se sobrescribió el registro.');
        }
        validatePreRegistration(person, new Date(person.createdAt));
        if (('invitationHash' in person || 'invitationExpiresAt' in person) && (!('invitationHash' in person) ||
            typeof person.invitationHash !== 'string' || !/^[a-f0-9]{64}$/.test(person.invitationHash) ||
            !('invitationExpiresAt' in person) || typeof person.invitationExpiresAt !== 'string' || !Number.isFinite(Date.parse(person.invitationExpiresAt)))) {
          throw new Error('La invitación de preinscripción es inválida. No se sobrescribió el registro.');
        }
        preinscriptions.push({ ...person, id: person.id, createdByManagerId: person.createdByManagerId, createdAt: person.createdAt,
          ...('invitationHash' in person && typeof person.invitationHash === 'string' && 'invitationExpiresAt' in person && typeof person.invitationExpiresAt === 'string' ?
            { invitationHash: person.invitationHash, invitationExpiresAt: person.invitationExpiresAt } : {}) });
      }
    }
    const rosterMembers: StoredRosterMember[] = [];
    if ('rosterMembers' in value) {
      if (!Array.isArray(value.rosterMembers)) throw new Error('Los rosters son inválidos. No se sobrescribió el registro.');
      for (const row of value.rosterMembers) {
        if (!row || typeof row !== 'object' || typeof row.tournamentId !== 'string' || !row.tournamentId ||
            typeof row.teamId !== 'string' || !row.teamId || typeof row.managerId !== 'string' || !row.managerId ||
            !isRosterPerson(row.person) || !isRosterRole(row.role)) throw new Error('Un integrante del roster es inválido. No se sobrescribió el registro.');
        rosterMembers.push(row);
      }
      const keys = rosterMembers.map(row => JSON.stringify([row.tournamentId, row.teamId, row.person.id]));
      if (new Set(keys).size !== keys.length) throw new Error('El roster contiene integrantes duplicados. No se sobrescribió.');
    }
    const documents = [...families.flatMap(family => [family.adult?.identification, ...family.children.map(child => child.identification)]),
      ...preinscriptions.map(person => person.identification)].filter(Boolean);
    const ids = [...families.flatMap(family => [family.id, ...family.children.map(child => child.id)]), ...preinscriptions.map(person => person.id)];
    const codes = families.flatMap(family => family.children.flatMap(child => [child.registrationNumber, ...child.registrationAliases]));
    if (new Set(documents).size !== documents.length || new Set(ids).size !== ids.length || new Set(codes).size !== codes.length) {
      throw new Error('El registro contiene identidades duplicadas. No se sobrescribió.');
    }
    const suffixes: Record<string, number> = {};
    for (const [key, next] of Object.entries(value.suffixes)) suffixes[key] = Number(next);
    for (const code of codes) {
      const suffix = /^([VE]-[1-9]\d{0,8})-([1-9]\d*)$/.exec(code);
      if (suffix && (!Number.isSafeInteger(Number(suffix[2])) || !(suffixes[suffix[1]] > Number(suffix[2])))) {
        throw new Error('El contador de registros permitiría reutilizar un número. No se sobrescribió.');
      }
    }
    const transfers: Transfer[] = [];
    if ('transfers' in value) {
      if (!Array.isArray(value.transfers)) throw new Error('Las solicitudes de representación son inválidas. No se sobrescribió el registro.');
      for (const transfer of value.transfers) {
        if (!transfer || typeof transfer !== 'object' || typeof transfer.hash !== 'string' || !/^[a-f0-9]{64}$/.test(transfer.hash) ||
            typeof transfer.childId !== 'string' || typeof transfer.from !== 'string' || typeof transfer.to !== 'string' ||
            typeof transfer.expiresAt !== 'string' || !Number.isFinite(Date.parse(transfer.expiresAt))) {
          throw new Error('Una solicitud de representación es inválida. No se sobrescribió el registro.');
        }
        transfers.push(transfer);
      }
    }
    const rosterRules: StoredRosterRules[] = [];
    if ('rosterRules' in value) {
      if (!Array.isArray(value.rosterRules)) throw new Error('Las reglas de roster persistidas son inválidas. No se sobrescribió.');
      for (const row of value.rosterRules) {
        if (!row || typeof row !== 'object' || typeof row.tournamentId !== 'string' || !row.tournamentId ||
            typeof row.organizerId !== 'string' || !row.organizerId || !Number.isSafeInteger(row.revision) || row.revision < 1 ||
            !(row.closedAt === null || typeof row.closedAt === 'string' && Number.isFinite(Date.parse(row.closedAt)))) {
          throw new Error('Una regla de roster persistida es inválida. No se sobrescribió.');
        }
        rosterRules.push({ ...row, rules: readRosterRules(row.rules) });
      }
      if (new Set(rosterRules.map(row => row.tournamentId)).size !== rosterRules.length) throw new Error('El reglamento contiene torneos duplicados. No se sobrescribió.');
    }
    return { version: 1, families, suffixes, transfers, preinscriptions, rosterMembers, rosterRules };
  }
  private write<T>(change: (_document: RegistryDocument) => T): T { // eslint-disable-line no-unused-vars
    if (this.persistentStore) return this.persistentStore.transaction(() => {
      const document = this.read();
      const result = change(document);
      this.persistentStore!.saveRegistration(JSON.stringify(document));
      return result;
    });
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const lockPath = `${this.path}.lock`;
    let lock: number;
    try { lock = openSync(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new ConflictException('El registro está ocupado. Vuelve a intentar; no se asignó ningún número.');
      throw error;
    }
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const document = this.read();
      const result = change(document);
      writeFileSync(temporary, JSON.stringify(document), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
      return result;
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
      closeSync(lock);
      unlinkSync(lockPath);
    }
  }
  usePersistentStore(store: OfficialStateStore) {
    if (store.registration() === null) {
      if (this.persistentStore) throw new Error('No se puede reemplazar un registro persistente por uno vacío.');
      const document = this.read();
      store.transaction(() => store.saveRegistration(JSON.stringify(document)));
    }
    this.persistentStore = store;
    this.read();
  }
  private family(document: RegistryDocument, key: string): StoredFamily {
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new ForbiddenException('Falta el acceso privado al registro familiar.');
    const hash = Buffer.from(digest(key), 'hex');
    const family = document.families.find(item => timingSafeEqual(Buffer.from(item.accessHash, 'hex'), hash));
    if (!family) throw new ForbiddenException('No tienes acceso a este registro familiar.');
    return family;
  }
  private project(family: StoredFamily): RegistrationFamily {
    return JSON.parse(JSON.stringify({ id: family.id, adult: family.adult, children: family.children }));
  }
  private validate<T>(action: () => T): T {
    try { return action(); }
    catch (error) {
      if (error instanceof Error) throw new BadRequestException(error.message);
      throw error;
    }
  }
  createAccess() {
    const key = randomBytes(32).toString('hex');
    this.write(document => { document.families.push({ id: personId(), accessHash: digest(key), adult: null, children: [] }); });
    return { key };
  }
  getFamily(key: string) { return this.project(this.family(this.read(), key)); }
  saveAdult(key: string, input: AdultRegistration) {
    const adult = this.validate(() => validateAdultRegistration(input));
    return this.write(document => {
      const family = this.family(document, key);
      if (family.adult && family.adult.identification !== adult.identification) throw new ConflictException('La cédula del responsable no se puede cambiar desde el editor.');
      if (document.families.some(item => item.id !== family.id && (item.adult?.identification === adult.identification ||
          item.children.some(child => child.identification === adult.identification)))) {
        throw new ConflictException('Esta cédula ya tiene un registro. Recupera su acceso o solicita una revisión; no se creó otra persona.');
      }
      const matches = document.preinscriptions.filter(person => person.identification === adult.identification ||
        !person.identification && person.representativeIdentification && person.birthDate === adult.birthDate &&
        normalizedPersonName(person.fullName) === normalizedPersonName(adult.fullName));
      if (matches.length > 1) throw new ConflictException('Hay más de una posible preinscripción. Solicita revisión; no se fusionaron identidades.');
      const pending = matches[0];
      if (pending) {
        this.assertSamePreinscription(pending, adult);
        if (family.adult || family.children.length) throw new ConflictException('Este acceso ya corresponde a otra identidad. Solicita revisión.');
        family.id = pending.id;
        document.preinscriptions = document.preinscriptions.filter(person => person.id !== pending.id);
      }
      if (!family.adult && !pending && !family.children.length) {
        const verified = this.verifiedLookup?.(adult.identification);
        if (verified) family.id = verified.id;
      }
      family.adult = { ...adult, id: family.id };
      return this.project(family);
    });
  }
  addMinor(key: string, input: MinorRegistration, legacyIdentificationExists: (_identification: string) => boolean = () => false) { // eslint-disable-line no-unused-vars
    const minor = this.validate(() => validateMinorRegistration(input));
    return this.write(document => {
      const family = this.family(document, key);
      if (!family.adult) throw new BadRequestException('Completa y guarda primero los datos obligatorios del representante.');
      if (minor.identification && (legacyIdentificationExists(minor.identification) ||
          document.families.some(item => item.adult?.identification === minor.identification || item.children.some(child => child.identification === minor.identification)))) {
        throw new ConflictException('Esta cédula ya tiene un registro. Solicita vincular el perfil existente; no se creó otro jugador.');
      }
      const normalizedName = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('es').replace(/\s+/g, ' ').trim();
      if (document.families.some(item => item.children.some(child => child.birthDate === minor.birthDate &&
          normalizedName(child.fullName) === normalizedName(minor.fullName)))) {
        throw new ConflictException('Hay un posible registro previo con ese nombre y fecha de nacimiento. Requiere revisión; no se fusionó ni creó otro jugador.');
      }
      const representative = family.adult.identification;
      const pending = document.preinscriptions.find(person => minor.identification && person.identification === minor.identification ||
        !person.identification && person.representativeIdentification === representative &&
        person.birthDate === minor.birthDate && normalizedPersonName(person.fullName) === normalizedPersonName(minor.fullName));
      if (pending) {
        this.assertSamePreinscription(pending, minor);
        if (pending.representativeIdentification !== representative) throw new ConflictException('La preinscripción corresponde a otro representante. Solicita revisión.');
        document.preinscriptions = document.preinscriptions.filter(person => person.id !== pending.id);
      }
      const next = document.suffixes[representative] ?? 1;
      if (!Number.isSafeInteger(next + 1)) throw new ConflictException('Se agotó la numeración disponible. Solicita revisión.');
      const registrationNumber = minor.identification || `${representative}-${next}`;
      if (!minor.identification) document.suffixes[representative] = next + 1;
      family.children.push({
        ...minor, id: pending?.id ?? personId(), registrationNumber, registrationAliases: [], representativeId: family.id
      });
      return this.project(family);
    });
  }
  addDocument(key: string, childId: string, input: unknown, legacyIdentificationExists: (_identification: string) => boolean = () => false) { // eslint-disable-line no-unused-vars
    const identification = this.validate(() => registrationIdentification(input));
    return this.write(document => {
      const family = this.family(document, key);
      const child = family.children.find(item => item.id === childId);
      if (!child) throw new NotFoundException('No se encontró ese representado en tu registro.');
      if (child.identification === identification) return this.project(family);
      if (child.identification) throw new ConflictException('La cédula ya fue incorporada. Su corrección requiere revisión.');
      if (legacyIdentificationExists(identification) || document.preinscriptions.some(person => person.identification === identification) ||
          document.families.some(item => item.adult?.identification === identification ||
          item.children.some(other => other.identification === identification))) {
        throw new ConflictException('Esta cédula ya tiene un registro. Solicita revisión; no se cambió el historial.');
      }
      child.registrationAliases.push(child.registrationNumber);
      child.identification = identification;
      child.registrationNumber = identification;
      return this.project(family);
    });
  }
  inviteTransfer(key: string, childId: string, identificationInput: unknown) {
    const identification = this.validate(() => registrationIdentification(identificationInput));
    const invitation = randomBytes(32).toString('hex');
    return this.write(document => {
      const family = this.family(document, key);
      if (!family.children.some(child => child.id === childId)) throw new NotFoundException('No se encontró ese representado en tu registro.');
      const destination = document.families.find(item => item.adult?.identification === identification);
      if (!destination || destination.id === family.id) throw new BadRequestException('El nuevo responsable debe tener otro registro adulto completo.');
      document.transfers = document.transfers.filter(item => item.childId !== childId && item.expiresAt > this.now());
      document.transfers.push({
        hash: digest(invitation), childId, from: family.id, to: destination.id,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString()
      });
      return { invitation };
    });
  }
  acceptTransfer(key: string, invitation: unknown, relationship: MinorRegistration['relationship'], consent: boolean) {
    if (typeof invitation !== 'string' || !/^[a-f0-9]{64}$/.test(invitation)) throw new BadRequestException('Introduce una invitación válida.');
    if (!['father', 'mother', 'guardian'].includes(relationship) || consent !== true) throw new BadRequestException('Indica tu relación y declara tu autorización para representar al menor.');
    return this.write(document => {
      const family = this.family(document, key);
      if (!family.adult) throw new BadRequestException('Guarda primero los datos del nuevo responsable.');
      const transfer = document.transfers.find(item => item.hash === digest(invitation) && item.to === family.id && item.expiresAt > this.now());
      if (!transfer) throw new ForbiddenException('La invitación no es válida para tu registro o ya venció.');
      const source = document.families.find(item => item.id === transfer.from);
      const child = source?.children.find(item => item.id === transfer.childId);
      if (!source || !child) throw new ConflictException('La representación ya cambió. Solicita otra invitación.');
      source.children = source.children.filter(item => item.id !== child.id);
      family.children.push({ ...child, representativeId: family.id, relationship, consent: true });
      document.transfers = document.transfers.filter(item => item.childId !== child.id);
      return this.project(family);
    });
  }
  private now() { return new Date().toISOString(); }
  private assertSamePreinscription(pending: PreinscribedPerson, person: { fullName: string; birthDate: string }) {
    if (pending.birthDate !== person.birthDate || normalizedPersonName(pending.fullName) !== normalizedPersonName(person.fullName)) {
      throw new ConflictException('Los datos no coinciden con la preinscripción existente. Solicita revisión; no se creó otra persona.');
    }
  }
  private findRosterPerson(document: RegistryDocument, input: string): RosterPerson | null {
    const key = normalizeProfileIdentification(input);
    if (!key) return null;
    for (const family of document.families) {
      if (family.adult && [family.adult.id, family.adult.identification].includes(key)) return {
        id: family.adult.id, identification: family.adult.identification, fullName: family.adult.fullName, isMinor: false, registrationStatus: 'registered'
      };
      const child = family.children.find(person => [person.id, person.identification, person.registrationNumber, ...person.registrationAliases].includes(key));
      if (child) return { id: child.id, identification: '', fullName: child.fullName, isMinor: registrationAge(child.birthDate) < 18, registrationStatus: 'registered' };
    }
    const pending = document.preinscriptions.find(person => person.id === key || person.identification && person.identification === key);
    if (!pending) return null;
    const isMinor = registrationAge(pending.birthDate) < 18;
    return { id: pending.id, identification: isMinor ? '' : pending.identification, fullName: pending.fullName, isMinor, registrationStatus: 'preinscribed' };
  }
  rosterPerson(input: string): RosterPerson | null { return this.findRosterPerson(this.read(), input) ?? this.verifiedLookup?.(input) ?? null; }
  registeredPersonId(input: string) { return this.findRosterPerson(this.read(), input)?.id; }
  rosterMembers(team: ManagerRosterTeam): RosterMember[] {
    const document = this.read();
    return this.membersFromDocument(document, team.tournamentId, team.teamId, team.managerId);
  }
  private membersFromDocument(document: RegistryDocument, tournamentId: string, teamId: string, managerId?: string): RosterMember[] {
    return document.rosterMembers.filter(row => row.tournamentId === tournamentId && row.teamId === teamId)
      .map(row => ({ person: this.findRosterPerson(document, row.person.id) ?? this.findRosterPerson(document, row.person.identification) ?? row.person,
        role: row.role, approvalStatus: 'approved', addedBy: 'manager',
        canInvite: document.preinscriptions.some(person => person.id === row.person.id && person.createdByManagerId === managerId) }));
  }
  rosterPersonnel(tournamentId: string) {
    const document = this.read();
    return document.rosterMembers.filter(row => row.tournamentId === tournamentId).map(row => ({
      teamId: row.teamId, role: row.role, person: this.findRosterPerson(document, row.person.id) ?? this.findRosterPerson(document, row.person.identification) ?? row.person
    }));
  }
  private mergedMembers(document: RegistryDocument, context: RosterRulesContext, teamId: string) {
    const stored = this.membersFromDocument(document, context.tournamentId, teamId);
    const ids = new Set(stored.map(row => row.person.id));
    return [...(context.members[teamId] ?? []).filter(row => !ids.has(row.person.id)), ...stored];
  }
  private policy(document: RegistryDocument, context: RosterRulesContext) {
    const policy = document.rosterRules.find(row => row.tournamentId === context.tournamentId);
    if (policy && policy.organizerId !== context.organizerId) throw new ConflictException('El organizador no coincide con el reglamento persistido. Solicita revisión.');
    return policy;
  }
  private closure(document: RegistryDocument, context: RosterRulesContext) {
    const policy = this.policy(document, context);
    const closure = policy ? rosterClosure(policy.rules, context.games, context.teamIds, new Date(this.now())) :
      { closed: false, latch: false, reason: 'Torneo anterior sin reglas de roster configuradas: no se aplican cupos ni cierre hasta que el organizador los guarde.' };
    return { policy, closure };
  }
  rosterRules(context: RosterRulesContext): RosterRulesView {
    const document = this.read();
    const { policy, closure } = this.closure(document, context);
    if (policy && !policy.closedAt && closure.latch) {
      this.write(locked => {
        const current = this.closure(locked, context);
        if (current.policy && !current.policy.closedAt && current.closure.latch) current.policy.closedAt = this.now();
      });
      return this.rosterRules(context);
    }
    return { tournamentId: context.tournamentId, tournamentName: context.tournamentName, organizerId: context.organizerId,
      revision: policy?.revision ?? 0, rules: policy?.rules ?? null, closedAt: policy?.closedAt ?? null,
      closed: Boolean(policy?.closedAt) || closure.closed,
      reason: policy?.closedAt ? 'Roster definitivo: incorporaciones cerradas simultáneamente para todo el torneo.' : closure.reason,
      games: context.games, teamIds: context.teamIds };
  }
  rosterAdmission(context: RosterRulesContext, teamId: string) {
    const view = this.rosterRules(context);
    return rosterAdmission(this.mergedMembers(this.read(), context, teamId), view.rules, view, view.closedAt);
  }
  saveRosterRules(context: RosterRulesContext, input: unknown, revision: number, reopen: boolean) {
    const rules = this.validate(() => readRosterRules(input));
    if (!Number.isSafeInteger(revision) || revision < 0 || typeof reopen !== 'boolean') throw new BadRequestException('Confirma la revisión del reglamento y si deseas reabrir las incorporaciones.');
    if (rules.cutoff.kind === 'round' && Object.keys(rules.cutoff.rounds).some(id => !context.games.some(game => game.gameId === id))) {
      throw new BadRequestException('Solo puedes asignar rondas a partidos de este torneo.');
    }
    this.write(document => {
      const current = this.policy(document, context);
      if ((current?.revision ?? 0) !== revision) throw new ConflictException('El reglamento cambió. Vuelve a cargarlo antes de guardar.');
      for (const teamId of context.teamIds) {
        const counts = rosterAdmission(this.mergedMembers(document, context, teamId), rules, { closed: false, reason: '' }, null);
        for (const group of rosterGroups) if (counts.groups[group.id].used > rules.caps[group.id]) {
          throw new ConflictException(`El equipo ${teamId} ya tiene ${counts.groups[group.id].used} en ${group.title}. El cupo no puede ser inferior ni se eliminarán integrantes.`);
        }
      }
      const closure = rosterClosure(rules, context.games, context.teamIds, new Date(this.now()));
      const currentClosedAt = current?.closedAt ?? (current && rosterClosure(current.rules, context.games, context.teamIds, new Date(this.now())).latch ? this.now() : null);
      const next: StoredRosterRules = { tournamentId: context.tournamentId, organizerId: context.organizerId,
        rules, revision: revision + 1, closedAt: (!reopen && currentClosedAt) || (closure.latch ? this.now() : null) };
      document.rosterRules = [...document.rosterRules.filter(row => row.tournamentId !== context.tournamentId), next];
    });
    return this.rosterRules(context);
  }
  configureOfficialRoster(context: RosterRulesContext, teamId: string, players: RosterMember[]) {
    const key = (person: RosterPerson) => (person.identification || person.id).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const allowed = new Set(players.map(row => key(row.person)));
    const snapshot = this.read();
    const removed = (document: RegistryDocument) => document.rosterMembers.filter(row => row.tournamentId === context.tournamentId &&
      row.teamId === teamId && row.role === 'PLAYER' && !allowed.has(key(row.person)));
    if (!this.policy(snapshot, context) && !removed(snapshot).length) return;
    this.write(document => {
      const current = this.mergedMembers(document, context, teamId);
      const existing = new Set(current.filter(row => row.role === 'PLAYER').map(row => key(row.person)));
      const { policy, closure } = this.closure(document, context);
      if (players.some(row => !existing.has(key(row.person))) && (policy?.closedAt || closure.closed)) {
        throw new ConflictException('El roster del torneo está cerrado: tampoco se pueden agregar jugadores por la ruta administrativa.');
      }
      if (policy && players.length > policy.rules.caps.players) throw new ConflictException('La plantilla supera el cupo de jugadores configurado para este torneo.');
      document.rosterMembers = document.rosterMembers.filter(row => row.tournamentId !== context.tournamentId ||
        row.teamId !== teamId || row.role !== 'PLAYER' || allowed.has(key(row.person)));
    });
  }
  private assertAdmission(document: RegistryDocument, team: ManagerRosterTeam, role: RosterRole, person: RosterPerson, addition?: RosterAddition) {
    if (!addition) {
      if (document.rosterRules.some(row => row.tournamentId === team.tournamentId)) throw new ConflictException('Falta el contexto oficial para validar los cupos y el cierre.');
      return;
    }
    const { context } = addition;
    if (context.tournamentId !== team.tournamentId || !context.teamIds.includes(team.teamId)) throw new ForbiddenException('El equipo no corresponde a este reglamento.');
    const { policy, closure } = this.closure(document, context);
    if (policy?.closedAt || closure.closed) throw new ConflictException(policy?.closedAt ? 'El roster del torneo está cerrado para todos los equipos.' : closure.reason);
    const members = this.mergedMembers(document, context, team.teamId);
    if (members.some(row => row.person.id === person.id)) throw new ConflictException('Esta persona ya figura en el roster.');
    const group = rosterGroup(role);
    if (policy && members.filter(row => rosterGroup(row.role) === group).length >= policy.rules.caps[group]) {
      throw new ConflictException(`Se agotó el cupo de ${rosterGroups.find(row => row.id === group)?.title} para este equipo.`);
    }
    addition.validate(person);
  }
  private appendRosterMember(document: RegistryDocument, team: ManagerRosterTeam, role: RosterRole, person: RosterPerson) {
    if (!isRosterRole(role)) throw new BadRequestException('Selecciona un cargo válido del roster.');
    if (document.rosterMembers.some(row => row.tournamentId === team.tournamentId && row.teamId === team.teamId &&
        (row.person.id === person.id || person.identification && row.person.identification === person.identification))) {
      throw new ConflictException('Esta persona ya figura en el roster. No se duplicó ni se cambió su cargo.');
    }
    document.rosterMembers.push({ tournamentId: team.tournamentId, teamId: team.teamId, managerId: team.managerId, role, person });
  }
  addRosterMember(team: ManagerRosterTeam, role: RosterRole, person: RosterPerson, addition?: RosterAddition) {
    if (!isRosterRole(role)) throw new BadRequestException('Selecciona un cargo válido del roster.');
    return this.write(document => {
      const current = this.findRosterPerson(document, person.id) ?? person;
      this.assertAdmission(document, team, role, current, addition);
      this.appendRosterMember(document, team, role, current);
    });
  }
  preinscribeRosterMember(team: ManagerRosterTeam, role: RosterRole, input: PreRegistration, addition?: RosterAddition) {
    const person = this.validate(() => validatePreRegistration(input));
    if (!isRosterRole(role)) throw new BadRequestException('Selecciona un cargo válido del roster.');
    return this.write(document => {
      if (person.identification && this.findRosterPerson(document, person.identification)) {
        throw new ConflictException('Esta cédula ya está guardada en el ecosistema. Búscala y utiliza su registro existente.');
      }
      if (person.isMinor && (document.preinscriptions.some(row => row.birthDate === person.birthDate &&
          normalizedPersonName(row.fullName) === normalizedPersonName(person.fullName)) ||
          document.families.some(family => family.children.some(child => child.birthDate === person.birthDate &&
            normalizedPersonName(child.fullName) === normalizedPersonName(person.fullName))))) {
        throw new ConflictException('Hay un posible registro previo del menor. Solicita revisión; no se creó otra identidad.');
      }
      const stored: PreinscribedPerson = { ...person, id: personId(), createdByManagerId: team.managerId, createdAt: this.now() };
      const projection: RosterPerson = {
        id: stored.id, identification: person.isMinor ? '' : stored.identification, fullName: stored.fullName,
        isMinor: person.isMinor, registrationStatus: 'preinscribed'
      };
      this.assertAdmission(document, team, role, projection, addition);
      document.preinscriptions.push(stored);
      this.appendRosterMember(document, team, role, projection);
    });
  }
  invitePreRegistration(team: ManagerRosterTeam, id: string) {
    const invitation = randomBytes(32).toString('hex');
    return this.write(document => {
      const person = document.preinscriptions.find(row => row.id === id && row.createdByManagerId === team.managerId);
      if (!person || !document.rosterMembers.some(row => row.person.id === id && row.teamId === team.teamId && row.tournamentId === team.tournamentId)) {
        throw new ForbiddenException('Solo el manager que realizó esta preinscripción puede generar su invitación privada.');
      }
      person.invitationHash = digest(invitation);
      person.invitationExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      return { invitation };
    });
  }
  recoverPreRegistration(key: string, invitation: unknown) {
    const document = this.read(), family = this.family(document, key);
    if (typeof invitation !== 'string' || !/^[a-f0-9]{64}$/.test(invitation)) throw new ForbiddenException('Introduce una invitación privada válida.');
    const hash = Buffer.from(digest(invitation), 'hex');
    const person = document.preinscriptions.find(row => row.invitationHash && row.invitationExpiresAt &&
      row.invitationExpiresAt > this.now() && timingSafeEqual(Buffer.from(row.invitationHash, 'hex'), hash));
    if (!person) throw new ForbiddenException('La invitación no existe, venció o ya se confirmó la preinscripción.');
    if (registrationAge(person.birthDate) < 18 && family.adult?.identification !== person.representativeIdentification) {
      throw new ForbiddenException('Guarda primero el perfil del representante indicado en la preinscripción.');
    }
    return { identification: person.identification, fullName: person.fullName, birthDate: person.birthDate,
      email: person.email, phone: person.phone, representativeIdentification: person.representativeIdentification };
  }
  players(): RegisteredMinor[] { return this.read().families.flatMap(family => family.children); }
  resolvePlayer(input: string): RegisteredMinor | undefined {
    const key = input.trim().toUpperCase();
    const documentKey = key.replace(/^([VE])\s*-?\s*0*(\d+)$/, '$1-$2');
    return this.players().find(player => player.id === key || player.registrationNumber === documentKey ||
      player.identification === documentKey || player.registrationAliases.includes(documentKey));
  }
}
