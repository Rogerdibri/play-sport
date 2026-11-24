'use client';

import { useEffect, useRef, useState } from 'react';
import {
  matchingFamilyChildren, newMinorRegistration, venezuelaStates,
  type DemoPersonalProfile, type MinorRegistration, type RegistrationClient, type RegistrationFamily
} from '@playsport/shared';
import { useNavigationBusy } from '../navigation-hooks';
import BirthDateInput from '../birth-date-input';

export default function FamilyRegistration({ client, profile, location }: {
  client: RegistrationClient; profile: DemoPersonalProfile | null; location: DemoPersonalProfile['location'];
}) {
  const [family, setFamily] = useState<RegistrationFamily | null>(null);
  const [draft, setDraft] = useState(() => newMinorRegistration(location));
  const current = useRef(draft);
  const [pending, setPending] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [documents, setDocuments] = useState<Record<string, string>>({});
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [invitation, setInvitation] = useState('');
  const [receivedInvitation, setReceivedInvitation] = useState('');
  const [preRegistrationInvitation, setPreRegistrationInvitation] = useState('');
  const [transferRelationship, setTransferRelationship] = useState<MinorRegistration['relationship']>('guardian');
  const [transferConsent, setTransferConsent] = useState(false);
  const busy = pending > 0;
  useNavigationBusy(busy);
  useEffect(() => {
    let active = true;
    void Promise.all([client.load(), client.readDraft()]).then(([saved, recovered]) => {
      if (!active) return;
      setFamily(saved); setError('');
      if (recovered) { current.current = recovered; setDraft(recovered); }
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'No se pudo recuperar el registro familiar.'); });
    return () => { active = false; };
  }, [client, profile, attempt]);
  const update = (patch: Partial<MinorRegistration>) => {
    const value = { ...current.current, ...patch };
    current.current = value; setDraft(value); setPending(count => count + 1); setNotice('');
    void client.draft(value).then(() => setError('')).catch(failure => {
      setError(failure instanceof Error ? failure.message : 'No se pudo conservar el borrador del menor.');
    }).finally(() => setPending(count => count - 1));
  };
  const perform = async (action: () => Promise<void>) => {
    setPending(count => count + 1); setWorking(true); setError(''); setNotice('');
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo completar el registro.'); }
    finally { setPending(count => count - 1); setWorking(false); }
  };
  const prepareAdult = async () => {
    if (!profile) throw new Error('Completa y guarda primero tu perfil de adulto con los datos obligatorios y al menos un contacto.');
    setFamily(await client.saveAdult(profile));
  };
  const state = venezuelaStates.find(item => item.id === draft.location.stateId);
  return <section className="managerCard managerStepCard" aria-labelledby="family-heading">
    <h2 id="family-heading">Mis hijos o representados</h2>
    <p>El registro se guarda en la API local; el acceso y el borrador se conservan en este dispositivo.
      La declaración del representante no es una verificación de parentesco o tutela.</p>
    <p>Sin cédula propia, el sistema asigna la cédula del responsable y un sufijo: -1, -2, -3. Es un número de registro privado, no la cédula del menor.
      No necesita teléfono, correo ni una cuenta independiente.</p>
    {!family ? <button className="managerButtonOutline" type="button" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Recuperar registro familiar</button> : <>
      {family.adult ? <p>Responsable: {family.adult.fullName} · Registro {family.adult.identification}</p> : <p>Guarda tu perfil para registrar al responsable.</p>}
      <label className="managerField"><span>Invitación privada de preinscripción del menor</span><input maxLength={64} autoComplete="off" value={preRegistrationInvitation}
        disabled={working || !profile} onChange={event => setPreRegistrationInvitation(event.target.value)} /></label>
      <button type="button" className="managerButtonOutline" disabled={busy || !profile} onClick={() => { void perform(async () => {
        await prepareAdult();
        const value = await client.recoverPreRegistration(preRegistrationInvitation);
        if (!value.isMinor) throw new Error('Esta invitación corresponde a un adulto; debe confirmarla desde su propio perfil.');
        update({ identification: value.identification, fullName: value.fullName, birthDate: value.birthDate, consent: false });
        setPreRegistrationInvitation(''); setNotice('Datos del menor recuperados. Revisa la relación, declara tu autorización y registra al menor para confirmar su mismo ID.');
      }); }}>Recuperar preinscripción del menor</button>
      <form onSubmit={event => {
        event.preventDefault();
        void perform(async () => {
          await prepareAdult();
          setFamily(await client.addMinor(current.current));
          const empty = newMinorRegistration(profile!.location);
          current.current = empty; setDraft(empty);
          setNotice('Menor registrado. Su identificador e historial son permanentes.');
          await client.draft(empty);
        });
      }}>
        <fieldset className="profileFields" disabled={working || !profile}>
          <legend>Agregar hijo o representado</legend>
          <div className="profileFieldGrid">
            <label className="managerField"><span>Nombre completo del menor</span><input required maxLength={120} value={draft.fullName} onChange={event => update({ fullName: event.target.value })} /></label>
            <BirthDateInput label="Fecha de nacimiento del menor" value={draft.birthDate} onChange={birthDate => update({ birthDate })} />
            <label className="managerField"><span>Cédula propia del menor (opcional)</span><input maxLength={20} placeholder="Déjala vacía si no tiene" value={draft.identification} onChange={event => update({ identification: event.target.value })} /></label>
            <label className="managerField"><span>Mi relación con el menor</span><select value={draft.relationship} onChange={event => {
              const relationship = event.target.value;
              if (relationship === 'father' || relationship === 'mother' || relationship === 'guardian') update({ relationship });
            }}><option value="father">Padre</option><option value="mother">Madre</option><option value="guardian">Representante autorizado</option></select></label>
            <label className="managerField"><span>Estado del menor</span><select required value={draft.location.stateId} onChange={event => {
              const selected = venezuelaStates.find(item => item.id === event.target.value);
              if (selected?.municipalities[0]) update({ location: { stateId: selected.id, municipalityId: selected.municipalities[0].id } });
            }}>{venezuelaStates.filter(item => item.municipalities.length).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="managerField"><span>Municipio del menor</span><select required value={draft.location.municipalityId} onChange={event => update({ location: { ...draft.location, municipalityId: event.target.value } })}>
              {state?.municipalities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
          </div>
          <label><input type="checkbox" required checked={draft.consent} onChange={event => update({ consent: event.target.checked })} /> Declaro que tengo autorización para representar e inscribir al menor.</label>
          <button className="managerButtonSolid" type="submit" disabled={busy}>Registrar menor</button>
        </fieldset>
      </form>
      <label className="managerField"><span>Buscar por registro, nombre o cédula del representante</span><input type="search" maxLength={120} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <p>{family.children.length} representado(s). Los datos de nacimiento, contacto y registro familiar no se publican en las pizarras, ni con un plan de pago.</p>
      <ul className="familyList">{matchingFamilyChildren(family, search).map(child => <li className="managerCard" key={child.id}>
        <h3>{child.fullName}</h3>
        <p>Número de registro: <strong>{child.registrationNumber}</strong></p>
        <p>{child.identification ? 'Con cédula propia.' : 'Sin cédula propia. Código de registro asignado por el sistema.'}</p>
        {child.registrationAliases.length ? <p>Referencia anterior: {child.registrationAliases.join(', ')}</p> : null}
        <p>Identificador permanente: {child.id}</p>
        {!child.identification ? <form onSubmit={event => { event.preventDefault(); void perform(async () => {
          setFamily(await client.addDocument(child.id, documents[child.id] ?? '')); setNotice('Cédula incorporada al mismo jugador. El registro anterior sigue siendo consultable.');
        }); }}>
          <fieldset className="profileFields" disabled={working}>
            <legend>Incorporar su cédula cuando la obtenga</legend>
            <label className="managerField"><span>Cédula de {child.fullName}</span><input required maxLength={20} value={documents[child.id] ?? ''} onChange={event => setDocuments(value => ({ ...value, [child.id]: event.target.value }))} /></label>
            <button type="submit" className="managerButtonOutline" disabled={busy}>Incorporar cédula sin perder historial</button>
          </fieldset>
        </form> : null}
        <details><summary>Cambiar representante sin crear otro jugador</summary>
          <p>El nuevo adulto debe guardar primero su perfil. Solo se transfiere cuando acepta la invitación desde su propio registro. El número no se renumera.</p>
          <form onSubmit={event => { event.preventDefault(); void perform(async () => {
            setInvitation(await client.inviteTransfer(child.id, destinations[child.id] ?? '')); setNotice('Invitación creada por siete días. Compártela solo con el nuevo responsable.');
          }); }}>
            <fieldset className="profileFields" disabled={working}>
              <label className="managerField"><span>Cédula del nuevo responsable de {child.fullName}</span><input required maxLength={20} value={destinations[child.id] ?? ''} onChange={event => setDestinations(value => ({ ...value, [child.id]: event.target.value }))} /></label>
              <button type="submit" className="managerButtonOutline" disabled={busy}>Crear invitación de cambio de representante</button>
            </fieldset>
          </form>
        </details>
      </li>)}</ul>
      {family.children.length > 0 && matchingFamilyChildren(family, search).length === 0 ? <p>No hay representados que coincidan.</p> : null}
      <details><summary>Vincular un menor ya registrado</summary>
        <p>No lo inscribas de nuevo. Solicita una invitación a su representante actual. Al aceptar, asumes su representación en este registro sin cambiar su jugador ni su historial.</p>
        <form onSubmit={event => { event.preventDefault(); void perform(async () => {
          await prepareAdult(); setFamily(await client.acceptTransfer(receivedInvitation.trim(), transferRelationship, transferConsent)); setReceivedInvitation(''); setTransferConsent(false); setNotice('Representación vinculada al mismo jugador, sin renumerarlo.');
        }); }}>
          <fieldset className="profileFields" disabled={busy || !profile}>
            <label className="managerField"><span>Invitación del representante actual</span><input required maxLength={64} value={receivedInvitation} onChange={event => setReceivedInvitation(event.target.value)} /></label>
            <label className="managerField"><span>Mi relación con el menor ya registrado</span><select value={transferRelationship} onChange={event => {
              const relationship = event.target.value;
              if (relationship === 'father' || relationship === 'mother' || relationship === 'guardian') setTransferRelationship(relationship);
            }}><option value="father">Padre</option><option value="mother">Madre</option><option value="guardian">Representante autorizado</option></select></label>
            <label><input type="checkbox" required checked={transferConsent} onChange={event => setTransferConsent(event.target.checked)} /> Declaro que estoy autorizado para asumir esta representación.</label>
            <button type="submit" className="managerButtonOutline">Aceptar representación del menor existente</button>
          </fieldset>
        </form>
      </details>
    </>}
    {invitation ? <p className="familyInvitation" role="status">Invitación privada: {invitation}</p> : null}
    {busy ? <p role="status">Guardando registro…</p> : null}
    {error ? <p className="managerWarning" role="alert">{error} Puedes reintentar sin borrar el perfil ni el historial.</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </section>;
}
