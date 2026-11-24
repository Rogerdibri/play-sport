'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  DemoProfileStore, RegistrationClient, newDemoPersonalProfile, profilePhotoMaxLength, socialNetworks, venezuelaStates,
  type DemoPersonalProfile
} from '@playsport/shared';
import { usePlatformSession } from '../platform-session';
import { demoSessionLocation } from '../platform-navigation';
import { useNavigationBusy } from '../navigation-hooks';
import FamilyRegistration from './family-registration';
import BirthDateInput from '../birth-date-input';
import { prepareLocalPhoto } from '../local-photo';
import AccountPhotoEditor from '../account-photo-editor';
import AccountAccess from '../account/account-access';

async function profilePhoto(file: File): Promise<string> {
  return prepareLocalPhoto(file, profilePhotoMaxLength);
}

export default function PersonalProfilePage() {
  const { session, ready, enter, account } = usePlatformSession();
  if (!ready) return <main className="moduleView"><p role="status">Abriendo tu perfil…</p></main>;
  if (!account || account.identity?.status !== 'verified') return <AccountAccess section="profile" />;
  const location = demoSessionLocation(session);
  return <ProfileEditor key={account.id} accountId={account.id}
    initial={{ ...newDemoPersonalProfile(account.id, location), identification: account.identity.identification,
      fullName: account.identity.fullName, birthDate: account.identity.birthDate, email: account.email }}
    onLocation={location => { if (session) enter({ ...session, location }); }} />;
}

function ProfileEditor({ accountId, initial, onLocation }: {
  accountId: string; initial: DemoPersonalProfile; onLocation: (_location: DemoPersonalProfile['location']) => void; // eslint-disable-line no-unused-vars
}) {
  const { account } = usePlatformSession();
  const store = useRef<DemoProfileStore | null>(null);
  if (!store.current) {
    let revision = 0;
    const remote = async (document?: unknown) => {
      const response = await fetch('/api/accounts/profile', { cache: 'no-store', ...(document === undefined ? {} :
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedAccountId: accountId, expectedRevision: revision, document }) }) });
      const value: unknown = await response.json();
      if (!response.ok || !value || typeof value !== 'object' || !('accountId' in value) || value.accountId !== accountId ||
          !('revision' in value) || typeof value.revision !== 'number' || !('document' in value))
        throw new Error(value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ? value.message : 'No se pudo recuperar el perfil de esta cuenta.');
      revision = value.revision;
      return JSON.stringify(value.document);
    };
    store.current = new DemoProfileStore(account ? { getItem: async () => remote(), setItem: async (_key, value) => { await remote(JSON.parse(value)); } } :
      { getItem: async key => globalThis.localStorage.getItem(key), setItem: async (key, value) => { globalThis.localStorage.setItem(key, value); } });
  }
  const [draft, setDraft] = useState(initial);
  const [savedProfile, setSavedProfile] = useState<DemoPersonalProfile | null>(null);
  const registry = useRef<RegistrationClient | null>(null);
  if (!registry.current) registry.current = new RegistrationClient(
    (process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? '/api/official-scoring').replace(/\/official-scoring\/?$/, ''),
    accountId, {
      getItem: async key => globalThis.localStorage.getItem(key),
      setItem: async (key, value) => { globalThis.localStorage.setItem(key, value); }
    });
  const current = useRef(initial);
  const [loaded, setLoaded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pending, setPending] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [invitation, setInvitation] = useState('');
  useNavigationBusy(pending > 0 || photoBusy);
  useEffect(() => {
    let active = true;
    void store.current!.load().then(document => {
      if (!active) return;
      const saved = document.saved.find(profile => profile.accountId === accountId);
      const value = document.drafts.find(profile => profile.accountId === accountId) ?? saved ?? initial;
      current.current = value; setDraft(value); setSavedProfile(saved ?? null); setLocked(Boolean(saved)); setLoaded(true); setError('');
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'No se pudo recuperar el perfil.'); });
    return () => { active = false; };
  }, [accountId, attempt]); // Initial values must not replace a recovered draft.
  const update = (patch: Partial<DemoPersonalProfile>) => {
    const value = { ...current.current, ...patch };
    current.current = value; setDraft(value); setNotice(''); setPending(count => count + 1);
    void store.current!.draft(value).then(() => setError('')).catch(failure => {
      setError(failure instanceof Error ? failure.message : 'No se pudo conservar el borrador del perfil.');
    }).finally(() => setPending(count => count - 1));
  };
  const save = async () => {
    setCommitting(true); setPending(count => count + 1); setError(''); setNotice('');
    try {
      await store.current!.draft(current.current);
      const document = await store.current!.save(accountId);
      const saved = document.saved.find(profile => profile.accountId === accountId);
      if (!saved) throw new Error('No se pudo confirmar el perfil guardado.');
      current.current = saved; setDraft(saved); setLocked(true); onLocation(saved.location);
      await registry.current!.saveAdult(saved);
      setSavedProfile(saved);
      setNotice(account ? 'Perfil único guardado en tu cuenta para todos tus roles.' : 'Perfil guardado: datos obligatorios registrados en la API local y datos complementarios conservados en este dispositivo.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar el perfil.'); }
    finally { setCommitting(false); setPending(count => count - 1); }
  };
  if (!loaded) return <main className="moduleView"><h1>Mi perfil</h1>
    {error ? <><p className="managerWarning" role="alert">{error}</p><button className="managerButtonOutline" onClick={() => setAttempt(value => value + 1)}>Reintentar</button></> :
      <p role="status">Recuperando tu perfil y su borrador…</p>}
  </main>;
  return <main className="moduleView personalProfile">
    <header className="moduleHeader"><h1>Mi perfil</h1>
      {account ? <p>Un solo perfil privado para todos tus roles. La cédula, el nombre y la fecha de nacimiento provienen de tu identidad verificada y no se cambian al elegir otro rol. Los datos se guardan en tu cuenta.</p> :
        <p>Tus datos complementarios y acceso familiar se conservan en este navegador.</p>}
    </header>
    {account ? <AccountPhotoEditor key={account.id} account={account} legacyPhoto={savedProfile?.photo} disabled={committing || pending > 0} /> :
      <p>Inicia sesión en <Link href="/account">Mi cuenta</Link> para guardar una foto compartida entre tus roles y tu billetera.</p>}
    {!account ? <section className="managerCard managerStepCard">
      <h2>Recuperar mi preinscripción</h2>
      <p>Si un manager ya te preinscribió, usa su invitación privada para recuperar tus datos sin volver a escribirlos. Después revisa y guarda el perfil para confirmar. Para menores, usa el apartado del representante.</p>
      <label className="managerField"><span>Invitación privada de mi preinscripción</span><input value={invitation} maxLength={64} autoComplete="off" disabled={committing || photoBusy}
        onChange={event => setInvitation(event.target.value)} /></label>
      <button type="button" className="managerButtonOutline" disabled={pending > 0 || photoBusy} onClick={() => { void (async () => {
        setCommitting(true); setPending(value => value + 1); setError(''); setNotice('');
        try {
          const value = await registry.current!.recoverPreRegistration(invitation);
          if (value.isMinor) throw new Error('Recupera esta preinscripción desde Mis hijos o representados del responsable.');
          if (locked && current.current.identification !== value.identification) throw new Error('Esta invitación corresponde a otra cédula; no se sustituyó el perfil.');
          update({ identification: value.identification, fullName: value.fullName, birthDate: value.birthDate, email: value.email, phone: value.phone });
          setInvitation(''); setNotice('Datos recuperados. Revísalos y guarda el perfil para confirmar la misma identidad.');
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo recuperar la preinscripción.'); }
        finally { setCommitting(false); setPending(value => value - 1); }
      })(); }}>Recuperar datos preinscritos</button>
    </section> : null}
    <form className="managerCard managerStepCard" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={photoBusy || committing} className="profileFields">
        <legend>Editar perfil</legend>
        {!account ? <section className="profilePhoto">
          {draft.photo ? <img src={draft.photo} alt="Foto del perfil" width={112} height={112} /> : <span className="profilePhotoPlaceholder" aria-label="Sin foto de perfil">Sin foto</span>}
          <label className="managerField"><span>Cargar foto de perfil</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={async event => {
              const file = event.target.files?.[0]; event.target.value = '';
              if (!file) return;
              setPhotoBusy(true); setError('');
              try { update({ photo: await profilePhoto(file) }); }
              catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo leer la imagen.'); }
              finally { setPhotoBusy(false); }
            }} />
          </label>
          <p>JPG, PNG o WebP, hasta 5 MB. Se reduce y se eliminan sus metadatos antes de guardarla.</p>
          {draft.photo ? <button className="managerButtonOutline" type="button" onClick={() => update({ photo: '' })}>Quitar foto</button> : null}
        </section> : null}
        <div className="profileFieldGrid">
          <label className="managerField"><span>{account ? 'Cédula privada del ecosistema' : 'Cédula de prueba'}</span><input value={draft.identification} maxLength={20} required readOnly={locked || !!account}
            placeholder="V-12345678" onChange={event => update({ identification: event.target.value })} /></label>
          <label className="managerField"><span>Nombre completo</span><input value={draft.fullName} maxLength={120} required readOnly={!!account} onChange={event => update({ fullName: event.target.value })} /></label>
          <BirthDateInput label="Fecha de nacimiento" value={draft.birthDate} disabled={!!account} onChange={birthDate => update({ birthDate })} />
          <label className="managerField"><span>Correo electrónico</span><input type="email" required={!draft.phone.trim()} maxLength={254} value={draft.email} onChange={event => update({ email: event.target.value })} /></label>
          <label className="managerField"><span>Teléfono</span><input type="tel" required={!draft.email.trim()} value={draft.phone} maxLength={30} onChange={event => update({ phone: event.target.value })} /></label>
          <label className="managerField"><span>Sexo</span><select value={draft.sex} onChange={event => {
            const sex = event.target.value;
            if (sex === '' || sex === 'female' || sex === 'male' || sex === 'not-specified') update({ sex });
          }}><option value="">Sin indicar</option><option value="female">Femenino</option><option value="male">Masculino</option><option value="not-specified">Prefiero no indicarlo</option></select></label>
          <label className="managerField"><span>Estado</span><select required value={draft.location.stateId} onChange={event => {
            const state = venezuelaStates.find(item => item.id === event.target.value);
            if (state?.municipalities[0]) update({ location: { stateId: state.id, municipalityId: state.municipalities[0].id } });
          }}>{venezuelaStates.filter(state => state.municipalities.length).map(state => <option key={state.id} value={state.id}>{state.name}</option>)}</select></label>
          <label className="managerField"><span>Municipio</span><select required value={draft.location.municipalityId}
            onChange={event => update({ location: { ...draft.location, municipalityId: event.target.value } })}>
            {venezuelaStates.find(state => state.id === draft.location.stateId)?.municipalities.map(municipality => <option key={municipality.id} value={municipality.id}>{municipality.name}</option>)}
          </select></label>
        </div>
        <label className="managerField"><span>Dirección detallada</span><textarea value={draft.address} maxLength={300} onChange={event => update({ address: event.target.value })} /></label>
        <p>{account ? 'Tu cédula es única y privada en todo PlaySport. Los cambios de identidad requieren revisión administrativa.' : locked ? 'La cédula queda fija en esta cuenta de prueba. Su corrección controlada se implementará con las cuentas reales.' :
          'Al guardar por primera vez, la cédula quedará fija y no podrá repetirse en otra cuenta de este navegador.'}</p>
        <h2>Redes sociales</h2>
        <p>Opcionales. Introduce el enlace completo https:// de cada red.</p>
        <div className="profileFieldGrid">{socialNetworks.map(network => <label className="managerField" key={network}><span>{network === 'x' ? 'X / Twitter' : network}</span>
          <input type="url" value={draft.social[network]} maxLength={500}
            onChange={event => update({ social: { ...current.current.social, [network]: event.target.value } })} />
        </label>)}</div>
        <p>Obligatorios: cédula, nombre y apellido, fecha de nacimiento, estado, municipio y al menos un contacto: correo electrónico o teléfono. Puedes indicar ambos.</p>
        {!account ? <p>Identificador técnico de prueba: {draft.id}. Estos datos no cambian roles, permisos o historial.</p> : null}
        <button className="managerButtonSolid" type="submit" disabled={pending > 0 || photoBusy}>Guardar perfil</button>
      </fieldset>
      {photoBusy ? <p role="status">Preparando foto…</p> : null}
      {pending > 0 ? <p role="status">Guardando en el dispositivo…</p> : null}
      {error ? <p className="managerWarning" role="alert">{error} Tus cambios permanecen en pantalla. Puedes volver a guardar.</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </form>
    <FamilyRegistration client={registry.current} profile={savedProfile} location={initial.location} />
    <Link className="managerButtonOutline" href="/">Volver a mi inicio</Link>
  </main>;
}
