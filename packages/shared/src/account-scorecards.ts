import { readPrivateSave } from './scorecard.js';

export type AccountScorecard = {
  scope: string;
  revision: number;
  save: ReturnType<typeof readPrivateSave>;
};
export function readAccountScorecard(value: unknown): AccountScorecard {
  if (!value || typeof value !== 'object' || !('scope' in value) || typeof value.scope !== 'string' ||
      !value.scope || value.scope.length > 1000 || !('revision' in value) || typeof value.revision !== 'number' ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 || !('save' in value))
    throw new Error('La planilla de la cuenta contiene datos inválidos.');
  return { scope: value.scope, revision: value.revision, save: readPrivateSave(JSON.stringify(value.save)) };
}
export class AccountScorecardClient {
  constructor(private readonly base = '/api/accounts/scorecards') {}
  private async request(scope?: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.base}${scope === undefined ? '' : `?${new URLSearchParams({ scope })}`}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'include', cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    });
    const value: unknown = await response.json();
    if (!response.ok) throw new Error(value && typeof value === 'object' && 'message' in value && typeof value.message === 'string'
      ? value.message : 'No se pudo consultar o guardar la planilla de tu cuenta.');
    return value;
  }
  async list(scope?: string): Promise<AccountScorecard[]> {
    const value = await this.request(scope);
    if (!value || typeof value !== 'object' || !('scorecards' in value) || !Array.isArray(value.scorecards))
      throw new Error('El servicio no confirmó las planillas de tu cuenta.');
    return value.scorecards.map(readAccountScorecard);
  }
  async save(scope: string, expectedRevision: number, save: AccountScorecard['save']) {
    return readAccountScorecard(await this.request(undefined, { scope, expectedRevision, save }));
  }
}
