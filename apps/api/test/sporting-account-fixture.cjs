const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { accountCookieName } = require('../src/modules/accounts/account-http');

module.exports = async function sportingAccountFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-sporting-account-'));
  const accounts = new AccountsService({ path: join(directory, 'accounts.sqlite') });
  let application;
  t.after(async () => {
    if (application) await application.close();
    if (accounts.db.isOpen) accounts.onModuleDestroy();
    rmSync(directory, { recursive: true, force: true });
  });
  const owner = await accounts.register(
    {
      email: 'official-fixture@example.test',
      displayName: 'Cuenta ficticia',
      password: 'Frase ficticia para pruebas deportivas 123456'
    },
    'fixture'
  );
  writeFileSync(join(directory, 'local-tester.json'), JSON.stringify({ version: 1, accountId: owner.account.id }), {
    mode: 0o600
  });
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('La cuenta de prueba solo puede consultar su servidor local.');
    const headers = new Headers(init?.headers);
    headers.set('Cookie', `${accountCookieName()}=${owner.token}`);
    headers.set('Origin', new URL(process.env.PLAYSPORT_WEB_ORIGIN ?? 'http://localhost:3000').origin);
    return nativeFetch(input, { ...init, headers });
  });
  return {
    provider: { provide: AccountsService, useValue: accounts },
    nativeFetch,
    manage(app) {
      application = app;
    },
    async verifiedScorekeeper(identificationNumber = 'V-99500001') {
      const reviewer = await accounts.register(
        { email: 'reviewer-fixture@example.test', displayName: 'Revisor ficticio', password: 'Frase ficticia del revisor 123456' },
        'reviewer-fixture'
      );
      const previous = [process.env.PLAYSPORT_ADMIN_ACCOUNT_ID, process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID];
      process.env.PLAYSPORT_ADMIN_ACCOUNT_ID = process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID = reviewer.account.id;
      t.after(() => {
        for (const [key, value] of [['PLAYSPORT_ADMIN_ACCOUNT_ID', previous[0]], ['PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID', previous[1]]])
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
      });
      const photo = 'data:image/jpeg;base64,' + Buffer.from([255, 216, 255, 1, 2, 3, 4, 5, 6, 7, 8, 9, 255, 217]).toString('base64');
      accounts.submitIdentity(owner.token, { expectedAccountId: owner.account.id, requestId: randomUUID(), expectedRevision: 0,
        identification: identificationNumber, fullName: 'Anotador Ficticio', birthDate: '1990-01-02',
        documentPhoto: photo, personalPhoto: photo, consent: true });
      accounts.reviewIdentity(reviewer.token, { expectedAccountId: reviewer.account.id, accountId: owner.account.id, expectedRevision: 1,
        decision: 'verified', reason: 'Prueba aislada', documentsMatch: true });
      accounts.activateRole(owner.token, { expectedAccountId: owner.account.id, role: 'scorekeeper' });
      const identity = accounts.authenticate(owner.token).identity;
      return { actorId: identity.actorId, identificationNumber: identity.identification };
    }
  };
};
