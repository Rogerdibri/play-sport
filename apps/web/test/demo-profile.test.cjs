const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  DemoProfileStore, demoProfilesKey, newDemoPersonalProfile, readDemoProfiles, isDemoPersonalProfile,
  normalizeProfileIdentification, profileSocialUrl, profilePhotoMaxLength, demoProfileLocation
} = require('@playsport/shared');

function fixture(accountId = 'fan-demo', identification = 'V-99900001') {
  return { ...newDemoPersonalProfile(accountId, demoProfileLocation), identification, fullName: 'Persona Ficticia', birthDate: '1990-01-01', email: 'ficticio@example.test' };
}
function memory() {
  let raw = null;
  let fail = false;
  const writes = [];
  return {
    storage: {
      getItem: async key => { assert.equal(key, demoProfilesKey); return raw; },
      setItem: async (key, value) => {
        assert.equal(key, demoProfilesKey);
        if (fail) throw new Error('Storage unavailable');
        await new Promise(resolve => setTimeout(resolve, 1));
        raw = value; writes.push(value);
      }
    },
    raw: () => raw, writes, fail: value => { fail = value; }, corrupt: value => { raw = value; }
  };
}
test('profile drafts allow incomplete fields and preserve stable account identity independently of cedula', () => {
  const profile = newDemoPersonalProfile('fan-demo', demoProfileLocation);
  assert.ok(isDemoPersonalProfile(profile));
  assert.equal(profile.id, 'demo-person:fan-demo');
  assert.equal(normalizeProfileIdentification(' v00123456 '), 'V-123456');
  assert.equal(isDemoPersonalProfile({ ...profile, sex: [] }), false);
  assert.equal(isDemoPersonalProfile({ ...profile, location: { stateId: 'VE-D', municipalityId: 'VE-A:libertador' } }), false);
  assert.deepEqual(readDemoProfiles(null), { version: 1, saved: [], drafts: [] });
});
test('profile storage restores unfinished inputs without committing them', async () => {
  const mem = memory(); const store = new DemoProfileStore(mem.storage);
  await store.load();
  await store.draft({ ...newDemoPersonalProfile('fan-demo', demoProfileLocation), fullName: 'Borrador' });
  const restored = await new DemoProfileStore(mem.storage).load();
  assert.equal(restored.saved.length, 0);
  assert.equal(restored.drafts[0].fullName, 'Borrador');
});
test('commits normalize fields, lock cedula and retain the same technical ID', async () => {
  const mem = memory(); const store = new DemoProfileStore(mem.storage);
  await store.load(); await store.draft({ ...fixture(), identification: 'v 99900001', fullName: '  Persona Ficticia  ' });
  const saved = (await store.save('fan-demo')).saved[0];
  assert.equal(saved.identification, 'V-99900001');
  assert.equal(saved.fullName, 'Persona Ficticia');
  await store.draft({ ...saved, phone: '+58 412 0000000' });
  assert.equal((await store.save('fan-demo')).saved[0].id, saved.id);
  const before = mem.raw();
  await assert.rejects(store.draft({ ...saved, identification: 'E-99900002' }), /modificadas/);
  assert.equal(mem.raw(), before);
});
test('local uniqueness applies across demo accounts without overwriting either profile', async () => {
  const mem = memory(); const store = new DemoProfileStore(mem.storage);
  await store.load(); await store.draft(fixture()); await store.save('fan-demo');
  await store.draft(fixture('player-demo'));
  await assert.rejects(store.save('player-demo'), /otra cuenta/);
  const document = readDemoProfiles(mem.raw());
  assert.equal(document.saved.length, 1);
  assert.equal(document.drafts.length, 2);
});
test('account drafts and saved profiles remain separate for all roles and managers', async () => {
  const mem = memory(); const store = new DemoProfileStore(mem.storage);
  await store.load();
  for (const [index, account] of ['fan-demo', 'player-demo', 'mgr-A', 'mgr-B', 'org-demo', 'scorer-demo', 'scout-demo'].entries()) {
    await store.draft(fixture(account, `V-9990000${index + 1}`));
    await store.save(account);
  }
  const document = await store.load();
  assert.equal(document.saved.length, 7);
  assert.equal(new Set(document.saved.map(profile => profile.id)).size, 7);
});
test('invalid required fields and phone numbers never produce success-shaped saves', async () => {
  const mem = memory(); const store = new DemoProfileStore(mem.storage); await store.load();
  for (const patch of [
    { identification: '0000' }, { identification: 'V-0' }, { fullName: 'Solo' }, { phone: 'abc1234567' }, { phone: '123' },
    { birthDate: '' }, { birthDate: '2023-02-29' }, { birthDate: '2099-01-01' }, { birthDate: '2020-01-01' },
    { email: '' }, { email: 'no-es-correo' }
  ]) {
    await store.draft({ ...fixture(), ...patch });
    await assert.rejects(store.save('fan-demo'));
    assert.equal(readDemoProfiles(mem.raw()).saved.length, 0);
  }
});
test('old saved profiles and drafts gain empty registration fields without losing photos, IDs or other data', async () => {
  const mem = memory();
  const old = fixture();
  delete old.birthDate; delete old.email;
  const draft = { ...old, phone: '+58 412 0000000' };
  mem.corrupt(JSON.stringify({ version: 1, saved: [old], drafts: [draft] }));
  const before = mem.raw();
  const store = new DemoProfileStore(mem.storage);
  const migrated = await store.load();
  assert.equal(mem.raw(), before, 'reading never overwrites legacy data');
  assert.deepEqual(migrated.saved[0], { ...old, birthDate: '', email: '' });
  assert.deepEqual(migrated.drafts[0], { ...draft, birthDate: '', email: '' });
  await assert.rejects(store.save(old.accountId), /nacimiento/);
  assert.equal(mem.raw(), before);
  await store.draft({ ...migrated.drafts[0], birthDate: '1990-01-01', email: 'ficticio@example.test' });
  const saved = (await store.save(old.accountId)).saved[0];
  assert.equal(saved.id, old.id);
  assert.equal(saved.phone, draft.phone);
});
test('profile commits accept email-only or phone-only contact without accepting two empty fields',async()=>{
  for(const contact of [{email:'ficticio@example.test',phone:''},{email:'',phone:'04121234567'}]){
    const mem=memory(),store=new DemoProfileStore(mem.storage);await store.load();await store.draft({...fixture(),...contact});
    const saved=(await store.save('fan-demo')).saved[0];assert.equal(saved.email,contact.email);assert.equal(saved.phone,contact.phone);
  }
  const mem=memory(),store=new DemoProfileStore(mem.storage);await store.load();await store.draft({...fixture(),email:'',phone:''});
  await assert.rejects(store.save('fan-demo'),/al menos un contacto/);
});
test('social links only accept HTTPS links on the corresponding social network', () => {
  assert.equal(profileSocialUrl('instagram', ' https://www.instagram.com/ejemplo/ '), 'https://www.instagram.com/ejemplo/');
  assert.equal(profileSocialUrl('x', 'https://twitter.com/ejemplo'), 'https://twitter.com/ejemplo');
  assert.equal(profileSocialUrl('youtube', ''), '');
  for (const value of ['javascript:alert(1)', 'http://instagram.com/demo', 'https://instagram.com.evil.test/demo',
    'https://evilinstagram.com/demo', 'https://user:password@instagram.com/demo', 'https://instagram.com:444/demo', 'not a URL']) {
    assert.throws(() => profileSocialUrl('instagram', value));
  }
  assert.throws(() => profileSocialUrl('facebook', 'https://instagram.com/demo'));
});
test('photo drafts only permit bounded local JPEG data, never tracking URLs or SVG', () => {
  assert.ok(isDemoPersonalProfile({ ...fixture(), photo: 'data:image/jpeg;base64,/9j/2Q==' }));
  for (const photo of ['https://example.test/avatar.jpg', 'data:image/svg+xml;base64,AAAA', 'data:image/jpeg;base64,**',
    `data:image/jpeg;base64,${'A'.repeat(profilePhotoMaxLength)}`]) {
    assert.equal(isDemoPersonalProfile({ ...fixture(), photo }), false);
  }
});
test('FIFO writes preserve the last draft even when several keystrokes are queued', async () => {
  const mem = memory(); const store = new DemoProfileStore(mem.storage); await store.load();
  await Promise.all(['P', 'Pe', 'Persona Ficticia'].map(fullName => store.draft({ ...fixture(), fullName })));
  assert.equal((await store.load()).drafts[0].fullName, 'Persona Ficticia');
  assert.equal(mem.writes.length, 3);
});
test('read/write failures preserve the last file and allow explicit retry', async () => {
  const mem = memory(); const store = new DemoProfileStore(mem.storage); await store.load(); await store.draft(fixture());
  const before = mem.raw(); mem.fail(true);
  await assert.rejects(store.draft({ ...fixture(), fullName: 'Otro Borrador' }), /Storage unavailable/);
  assert.equal(mem.raw(), before);
  mem.fail(false); await store.load(); await store.draft({ ...fixture(), fullName: 'Otro Borrador' });
  assert.equal((await store.load()).drafts[0].fullName, 'Otro Borrador');
  mem.corrupt('broken-json');
  await assert.rejects(store.load(), /No se pueden leer/);
  await assert.rejects(store.draft(fixture()), /No se pueden leer/);
  assert.equal(mem.raw(), 'broken-json');
});
