const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { readAccountProfile } = require('@playsport/shared');
const photo =
  'data:image/jpeg;base64,' + Buffer.from([255, 216, 255, 1, 2, 3, 4, 5, 6, 7, 8, 9, 255, 217]).toString('base64');
const bad = (fn, status) => assert.throws(fn, (error) => error.getStatus?.() === status);
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'playsport-person-')),
    path = join(dir, 'accounts.sqlite');
  let service = new AccountsService({ path });
  const create = (email) =>
    service.register(
      {
        email: `${email}@example.test`,
        displayName: `${email} ficticio`,
        password: 'Frase de prueba suficientemente larga 123'
      },
      email
    );
  const reviewer = await create('reviewer'),
    person = await create('person'),
    other = await create('other');
  writeFileSync(join(dir, 'local-tester.json'), JSON.stringify({ version: 1, accountId: reviewer.account.id }), {
    mode: 0o600
  });
  t.after(() => {
    service.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });
  const command = (patch = {}) => ({
    expectedAccountId: person.account.id,
    requestId: randomUUID(),
    expectedRevision: 0,
    identification: 'v-0012345678',
    fullName: 'Persona Ficticia',
    birthDate: '1990-01-02',
    documentPhoto: photo,
    personalPhoto: photo,
    consent: true,
    ...patch
  });
  const review = (patch = {}) => ({
    expectedAccountId: reviewer.account.id,
    accountId: person.account.id,
    expectedRevision: 1,
    decision: 'verified',
    reason: 'Cotejo ficticio de ambas imágenes y datos',
    documentsMatch: true,
    ...patch
  });
  return {
    dir,
    path,
    reviewer,
    person,
    other,
    command,
    review,
    get service() {
      return service;
    },
    restart() {
      service.onModuleDestroy();
      service = new AccountsService({ path });
      return service;
    }
  };
}
test('global identity requires both private images and consent; no self-verification or role field grants access', async (t) => {
  const e = await setup(t);
  bad(() => e.service.submitIdentity(undefined, e.command()), 401);
  for (const patch of [
    { documentPhoto: '' },
    { personalPhoto: '' },
    { consent: false },
    { verified: true },
    { birthDate: '2990-01-02' }
  ])
    bad(() => e.service.submitIdentity(e.person.token, e.command(patch)), 400);
  bad(() => e.service.identityQueue(e.person.token), 403);
  bad(() => e.service.identityEvidence(e.person.token, e.person.account.id), 403);
  const result = e.service.submitIdentity(e.person.token, e.command());
  assert.equal(result.account.identity.status, 'pending');
  assert.equal(result.account.identity.identification, 'V-12345678');
  assert.equal(result.account.identityVerification, 'unavailable');
  assert.equal(e.service.verifiedPerson('V-12345678'), null);
  assert.equal(JSON.stringify(result).includes(photo), false);
  bad(() => e.service.reviewIdentity(e.person.token, e.review({ expectedAccountId: e.person.account.id })), 403);
  bad(() => e.service.reviewIdentity(e.reviewer.token, e.review({ documentsMatch: false })), 400);
  e.service.reviewIdentity(e.reviewer.token, e.review());
  const account = readAccountProfile(e.service.authenticate(e.person.token));
  assert.equal(account.identity.status, 'verified');
  assert.equal(account.identityVerification, 'manual');
  assert.equal(account.financialAccess, false);
  assert.equal(e.service.verifiedPerson('V-12345678').accountId, account.id);
  assert.match(account.identity.actorId, /^person:[a-f0-9-]{36}$/);
  assert.equal(account.identity.actorId.includes('12345678'), false);
  bad(() => e.service.submitIdentity(e.person.token, e.command({ expectedRevision: 2 })), 409);
  bad(() => e.service.identityEvidence(e.reviewer.token, e.person.account.id), 404);
  assert.equal(e.restart().authenticate(e.person.token).identity.status, 'verified');
});
test('normalized cedulas are unique, evidence is encrypted and deleted after review, decisions are audited', async (t) => {
  const e = await setup(t),
    command = e.command();
  e.service.submitIdentity(e.person.token, command);
  e.service.submitIdentity(e.person.token, command);
  bad(() => e.service.submitIdentity(e.person.token, { ...command, fullName: 'Otro Nombre' }), 409);
  bad(
    () =>
      e.service.submitIdentity(
        e.other.token,
        e.command({ expectedAccountId: e.other.account.id, identification: 'V-12345678' })
      ),
    409
  );
  const db = new DatabaseSync(e.path, { readOnly: true });
  t.after(() => db.close());
  const row = db.prepare('SELECT * FROM person_identities').get();
  assert.equal(row.evidence.includes(photo), false);
  assert.equal(statSync(join(e.dir, 'identity.key')).mode & 0o777, 0o600);
  assert.equal(readFileSync(e.path).includes(photo), false);
  assert.deepEqual(e.service.identityEvidence(e.reviewer.token, e.person.account.id), {
    documentPhoto: photo,
    personalPhoto: photo
  });
  bad(() => e.service.reviewIdentity(e.reviewer.token, e.review({ expectedRevision: 0 })), 409);
  e.service.reviewIdentity(
    e.reviewer.token,
    e.review({ decision: 'rejected', documentsMatch: false, reason: 'Imagen ficticia ilegible' })
  );
  assert.equal(db.prepare('SELECT evidence FROM person_identities').get().evidence, '');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM identity_reviews').get().n, 1);
  e.service.submitIdentity(
    e.other.token,
    e.command({ expectedAccountId: e.other.account.id, identification: 'V-12345678' })
  );
  assert.equal(e.service.authenticate(e.other.token).identity.status, 'pending');
});
test('even the explicit administrative reviewer cannot approve their own identity', async (t) => {
  const e = await setup(t);
  e.service.submitIdentity(
    e.reviewer.token,
    e.command({ expectedAccountId: e.reviewer.account.id, identification: 'V-87654321' })
  );
  bad(() => e.service.reviewIdentity(e.reviewer.token, e.review({ accountId: e.reviewer.account.id })), 403);
  assert.equal(e.service.authenticate(e.reviewer.token).identity.status, 'pending');
});
test('one private account profile survives role changes and restart and cannot replace the verified personal identity', async (t) => {
  const e = await setup(t);
  bad(() => e.service.personalProfile(e.person.token), 403);
  e.service.submitIdentity(e.person.token, e.command());
  e.service.reviewIdentity(e.reviewer.token, e.review());
  const { newDemoPersonalProfile, demoProfileLocation } = require('@playsport/shared');
  const identity = e.service.authenticate(e.person.token).identity;
  const profile = {
    ...newDemoPersonalProfile(e.person.account.id, demoProfileLocation),
    identification: identity.identification,
    fullName: identity.fullName,
    birthDate: identity.birthDate,
    email: e.person.account.email
  };
  const input = {
    expectedAccountId: e.person.account.id,
    expectedRevision: 0,
    document: { version: 1, saved: [profile], drafts: [] }
  };
  e.service.changePersonalProfile(e.person.token, input);
  assert.equal(e.service.personalProfile(e.person.token).document.saved[0].fullName, identity.fullName);
  bad(() => e.service.changePersonalProfile(e.other.token, input), 403);
  bad(() => e.service.changePersonalProfile(e.person.token, input), 409);
  bad(
    () =>
      e.service.changePersonalProfile(e.person.token, {
        ...input,
        expectedRevision: 1,
        document: { version: 1, saved: [{ ...profile, fullName: 'Otra Persona' }], drafts: [] }
      }),
    403
  );
  assert.equal(e.restart().personalProfile(e.person.token).revision, 1);
});
