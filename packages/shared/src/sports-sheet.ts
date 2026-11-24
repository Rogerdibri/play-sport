import { isPlatformRoleId, type PlatformRoleId } from './platform.js';
import { readAccountPhoto } from './accounts.js';

export const sportsSheetSports = ['Béisbol', 'Softbol', 'Fútbol', 'Baloncesto', 'Voleibol', 'Tenis', 'Atletismo', 'Natación', 'Otro'] as const;
export const sportsSheetDiscipline = { label: 'Béisbol / Softbol', sports: ['Béisbol', 'Softbol'] } as const;
export type SportsRoleCard = {
  role: PlatformRoleId; specialty: string; category: string; positions: string; number: string;
  bats: '' | 'right' | 'left' | 'switch'; throws: '' | 'right' | 'left'; available: boolean;
};
export type SportsSheet = {
  sportingName: string; city: string; sports: string[]; cards: SportsRoleCard[];
  privacy: { published: boolean; city: boolean; photo: boolean; teams: boolean; availability: boolean };
};
export type SportsSheetTeam = {
  role: 'player' | 'manager'; tournamentId: string; tournamentName: string;
  teamId: string; teamName: string; leagueName: string; published: boolean;
};
export type SportsSheetSnapshot = {
  accountId: string; revision: number; publicRef: string | null; document: SportsSheet; teams: SportsSheetTeam[];
};
export type PublicSportsSheet = {
  name: string; photo: string; verifiedIdentity: boolean; city: string; sports: string[];
  cards: Array<Omit<SportsRoleCard, 'available'> & { available?: boolean }>;
  teams: Array<Pick<SportsSheetTeam, 'role' | 'teamName' | 'tournamentName' | 'leagueName'>>;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).length !== expected.length || Object.keys(value).some(key => !expected.includes(key)))
    throw new Error('La hoja deportiva contiene campos no permitidos o incompletos.');
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value))
    throw new Error('Revisa el texto y la longitud de los campos de la hoja deportiva.');
  return value.trim();
}
export function newSportsRoleCard(role: PlatformRoleId): SportsRoleCard {
  return { role, specialty: '', category: '', positions: '', number: '', bats: '', throws: '', available: false };
}
export function newSportsSheet(): SportsSheet {
  return { sportingName: '', city: '', sports: [], cards: [],
    privacy: { published: false, city: false, photo: false, teams: false, availability: false } };
}
export function readSportsSheet(value: unknown): SportsSheet {
  if (!object(value)) throw new Error('La hoja deportiva no es válida.');
  keys(value, ['sportingName', 'city', 'sports', 'cards', 'privacy']);
  if (!Array.isArray(value.sports) || value.sports.length > sportsSheetSports.length ||
      !value.sports.every(sport => typeof sport === 'string' && sportsSheetSports.some(item => item === sport)) ||
      new Set(value.sports).size !== value.sports.length || !Array.isArray(value.cards) || value.cards.length > 6 ||
      !object(value.privacy)) throw new Error('Los deportes, roles o privacidad de la hoja no son válidos.');
  const cards = value.cards.map<SportsRoleCard>(card => {
    if (!object(card)) throw new Error('La ficha de rol no es válida.');
    keys(card, ['role', 'specialty', 'category', 'positions', 'number', 'bats', 'throws', 'available']);
    if (!isPlatformRoleId(card.role) ||
        !(card.bats === '' || card.bats === 'right' || card.bats === 'left' || card.bats === 'switch') ||
        !(card.throws === '' || card.throws === 'right' || card.throws === 'left') || typeof card.available !== 'boolean')
      throw new Error('Revisa el rol, lateralidad y disponibilidad de la ficha.');
    const number = text(card.number, 3);
    if (number && !/^\d{1,3}$/.test(number)) throw new Error('El dorsal debe tener de uno a tres dígitos.');
    return { role: card.role, specialty: text(card.specialty, 120), category: text(card.category, 80),
      positions: text(card.positions, 120), number, bats: card.bats, throws: card.throws, available: card.available };
  });
  if (new Set(cards.map(card => card.role)).size !== cards.length) throw new Error('Cada rol tiene una sola ficha por cuenta.');
  keys(value.privacy, ['published', 'city', 'photo', 'teams', 'availability']);
  const { published, city, photo, teams, availability } = value.privacy;
  if (typeof published !== 'boolean' || typeof city !== 'boolean' || typeof photo !== 'boolean' ||
      typeof teams !== 'boolean' || typeof availability !== 'boolean')
    throw new Error('La privacidad de la hoja no es válida.');
  return { sportingName: text(value.sportingName, 80), city: text(value.city, 80), sports: value.sports, cards,
    privacy: { published, city, photo, teams, availability } };
}
export function readSportsSheetSnapshot(value: unknown, accountId: string): SportsSheetSnapshot {
  if (!object(value) || value.accountId !== accountId || !Number.isSafeInteger(value.revision) ||
      typeof value.revision !== 'number' || value.revision < 0 ||
      !(value.publicRef === null || typeof value.publicRef === 'string' && /^[a-zA-Z0-9_-]{24}$/.test(value.publicRef)) ||
      !Array.isArray(value.teams)) throw new Error('No se pudo comprobar la hoja deportiva de esta cuenta.');
  const teams = value.teams.map<SportsSheetTeam>(team => {
    if (!object(team) || !(team.role === 'player' || team.role === 'manager') || typeof team.published !== 'boolean')
      throw new Error('Los equipos de la hoja deportiva no son válidos.');
    return { role: team.role, tournamentId: text(team.tournamentId, 200),
      tournamentName: text(team.tournamentName, 200), teamId: text(team.teamId, 200),
      teamName: text(team.teamName, 200), leagueName: text(team.leagueName, 200), published: team.published };
  });
  return { accountId, revision: value.revision, publicRef: value.publicRef,
    document: readSportsSheet(value.document), teams };
}
export function projectPublicSportsSheet(document: SportsSheet, identity: {
  name: string; photo?: string; verifiedIdentity: boolean;
}, teams: readonly SportsSheetTeam[]): PublicSportsSheet {
  return {
    name: document.sportingName || identity.name,
    photo: document.privacy.photo ? identity.photo ?? '' : '',
    verifiedIdentity: identity.verifiedIdentity,
    city: document.privacy.city ? document.city : '',
    sports: [...document.sports],
    cards: document.cards.map(({ available, ...card }) => ({ ...card, ...(document.privacy.availability ? { available } : {}) })),
    teams: document.privacy.teams ? teams.filter(team => team.published)
      .map(({ role, teamName, tournamentName, leagueName }) => ({ role, teamName, tournamentName, leagueName })) : [],
  };
}
export function readPublicSportsSheet(value: unknown): PublicSportsSheet {
  if (!object(value) || typeof value.verifiedIdentity !== 'boolean' || !Array.isArray(value.cards) || !Array.isArray(value.teams))
    throw new Error('La hoja deportiva pública no es válida.');
  keys(value, ['name', 'photo', 'verifiedIdentity', 'city', 'sports', 'cards', 'teams']);
  const availability = value.cards.map(card => {
    if (!object(card) || 'available' in card && typeof card.available !== 'boolean')
      throw new Error('La disponibilidad pública no es válida.');
    return typeof card.available === 'boolean' ? card.available : undefined;
  });
  const document = readSportsSheet({ sportingName: value.name, city: value.city, sports: value.sports,
    cards: value.cards.map(card => object(card) ? { ...card, available: card.available ?? false } : card),
    privacy: newSportsSheet().privacy });
  const teams = value.teams.map<PublicSportsSheet['teams'][number]>(team => {
    if (!object(team) || !(team.role === 'player' || team.role === 'manager')) throw new Error('El equipo público no es válido.');
    keys(team, ['role', 'teamName', 'tournamentName', 'leagueName']);
    return { role: team.role, teamName: text(team.teamName, 200),
      tournamentName: text(team.tournamentName, 200), leagueName: text(team.leagueName, 200) };
  });
  return { name: document.sportingName, photo: readAccountPhoto(value.photo), verifiedIdentity: value.verifiedIdentity,
    city: document.city, sports: document.sports, teams,
    cards: document.cards.map(({ available: _available, ...card }, index) => // eslint-disable-line no-unused-vars
      ({ ...card, ...(availability[index] === undefined ? {} : { available: availability[index] }) })) };
}
