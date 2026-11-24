'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { newSportsRoleCard, platformRoles, projectPublicSportsSheet, readSportsSheetSnapshot, sportsSheetDiscipline,
  type AccountProfile, type SportsRoleCard, type SportsSheet, type SportsSheetSnapshot } from '@playsport/shared';
import { usePlatformSession } from '../platform-session';
import { useNavigationBusy } from '../navigation-hooks';
import SportsSheetView, { roleAvailability } from './sports-sheet-view';
import AccountAvatar from '../account-avatar';

async function fetchSportsSheet(accountId: string, command?: { expectedRevision: number; document: SportsSheet }) {
  const response = await fetch('/api/sports-sheet/me', { cache: 'no-store', signal: AbortSignal.timeout(10000),
    ...(command ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedAccountId: accountId, ...command }) } : {}) });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ?
    body.message : 'No se pudo recuperar o guardar la hoja deportiva.');
  return readSportsSheetSnapshot(body, accountId);
}
export default function SportsSheetPage() {
  const { account, ready } = usePlatformSession();
  if (!ready) return <main className="moduleView"><p role="status">Abriendo tu hoja deportiva…</p></main>;
  if (!account) return <main className="moduleView"><header className="moduleHeader"><h1>Mi hoja deportiva</h1>
    <p><strong>Disciplina:</strong> {sportsSheetDiscipline.label}</p>
    <p>Una sola hoja privada para todos tus roles.</p></header>
    <section className="managerCard managerStepCard"><p>Inicia sesión para consultar y guardar tu hoja deportiva.</p>
      <Link href="/account" className="managerButtonOutline">Mi cuenta</Link></section></main>;
  return <SportsSheetEditor key={account.id} account={account} />;
}
function SportsSheetEditor({ account }: { account: AccountProfile }) {
  const [snapshot, setSnapshot] = useState<SportsSheetSnapshot | null>(null);
  const [draft, setDraft] = useState<SportsSheet | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useNavigationBusy(saving);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void fetchSportsSheet(account.id).then(value => {
      if (active) { setSnapshot(value); setDraft(value.document); setNotice(''); }
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'No se pudo recuperar tu hoja deportiva.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account.id, attempt]);
  const update = (patch: Partial<SportsSheet>) => { setDraft(value => value ? { ...value, ...patch } : value); setNotice(''); };
  const updateCard = (index: number, patch: Partial<SportsRoleCard>) => {
    if (draft) update({ cards: draft.cards.map((card, position) => position === index ? { ...card, ...patch } : card) });
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !snapshot || saving || loading) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const value = await fetchSportsSheet(account.id, { expectedRevision: snapshot.revision, document: draft });
      setSnapshot(value); setDraft(value.document);
      setNotice(value.document.privacy.published ? 'Hoja guardada. La versión deportiva está publicada.' : 'Hoja guardada. Solo tú puedes consultarla.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo confirmar el guardado. Conservamos tus cambios en esta pantalla.'); }
    finally { setSaving(false); }
  };
  const reload = () => {
    if (draft && snapshot && JSON.stringify(draft) !== JSON.stringify(snapshot.document) &&
      !globalThis.confirm('Se descartarán los cambios sin guardar de esta hoja. ¿Recargar la versión guardada?')) return;
    setAttempt(value => value + 1);
  };
  const changed = Boolean(draft && snapshot && JSON.stringify(draft) !== JSON.stringify(snapshot.document));
  return <main className="moduleView sportsSheet">
    <header className="moduleHeader"><h1>Mi hoja deportiva</h1>
      <p><strong>Disciplina:</strong> {sportsSheetDiscipline.label}</p>
      <p>Una sola hoja para todos tus roles. Tus fichas no cambian al cambiar de rol.</p>
      <div className="managerButtonRow"><Link href="/profile" className="managerButtonOutline">Mi perfil y foto</Link>
        <Link href="/sports-sheet/statistics" className="managerButtonOutline">Mis estadísticas</Link>
        <Link href="/sports-sheet/career" className="managerButtonOutline">Mi trayectoria</Link>
        {account.localTestAccess ? <Link href="/sports-sheet/example" className="managerButtonOutline">Ver hoja de ejemplo</Link> : null}</div>
    </header>
    {error ? <section className="managerCard managerStepCard"><p className="managerWarning" role="alert">{error}</p>
      <button className="managerButtonOutline" type="button" disabled={saving || loading} onClick={reload}>Recargar versión guardada</button></section> : null}
    {loading ? <p role="status">Recuperando tu hoja deportiva…</p> : draft && snapshot ? <>
      <section className="managerCard managerStepCard">
        <h2>{snapshot.document.privacy.published ? 'Estado actual: pública' : 'Estado actual: privada'}</h2>
        <p>{changed ? 'Tienes cambios sin guardar. La versión guardada aún no ha cambiado.' : 'Los datos se guardan en tu cuenta, no en el rol ni en este dispositivo.'}</p>
        {notice ? <p role="status">{notice}</p> : null}
        {snapshot.document.privacy.published && snapshot.publicRef ? <Link className="managerButtonOutline"
          href={`/sports-sheet/${snapshot.publicRef}`}>Abrir enlace público para compartir</Link> : null}
      </section>
      <form onSubmit={save}>
        <fieldset disabled={saving || loading} className="sportsSheetForm">
          <section className="managerCard managerStepCard"><h2>Identidad deportiva</h2>
            <div className="sportsSheetIdentity sportsSheetOwnerIdentity"><AccountAvatar account={account} size={64} />
              <div><strong>{draft.sportingName || account.displayName}</strong>
                <p>{account.identity?.status === 'verified' ? 'Identidad verificada' : 'Identidad pendiente de verificar'}</p></div>
            </div>
            <p>La foto se comparte con tu cuenta. Tu cédula, fecha de nacimiento, correo y billetera nunca se incluyen en la hoja pública.</p>
            <div className="sportsSheetGrid">
              <label className="managerField"><span>Nombre deportivo</span><input value={draft.sportingName} maxLength={80}
                placeholder={account.displayName} onChange={event => update({ sportingName: event.target.value })} /></label>
              <label className="managerField"><span>Ciudad deportiva (opcional, sin dirección exacta)</span><input value={draft.city} maxLength={80}
                onChange={event => update({ city: event.target.value })} /></label>
            </div>
            <fieldset className="sportsSheetChoices"><legend>Deportes de mi ficha dentro de {sportsSheetDiscipline.label}</legend>
              {sportsSheetDiscipline.sports.map(sport => <label key={sport}><input type="checkbox" checked={draft.sports.includes(sport)}
                onChange={event => update({ sports: event.target.checked ? [...draft.sports, sport] : draft.sports.filter(item => item !== sport) })} />{sport}</label>)}
            </fieldset>
            {draft.sports.some(sport => !sportsSheetDiscipline.sports.some(item => item === sport)) ?
              <p>Otros deportes guardados: {draft.sports.filter(sport => !sportsSheetDiscipline.sports.some(item => item === sport)).join(' · ')}.
                Se conservan sin cambios; su edición estará disponible cuando se habiliten esas disciplinas.</p> : null}
          </section>
          <section className="managerCard managerStepCard"><h2>Mis fichas por rol</h2>
            <p>Selecciona los roles que deseas presentar. Esta información declarada no otorga permisos ni acredita certificaciones.</p>
            <fieldset className="sportsSheetChoices"><legend>Roles de mi hoja</legend>
              {platformRoles.map(role => <label key={role.id}><input type="checkbox" checked={draft.cards.some(card => card.role === role.id)}
                onChange={event => update({ cards: event.target.checked ? [...draft.cards, newSportsRoleCard(role.id)] :
                  draft.cards.filter(card => card.role !== role.id) })} />{role.label}</label>)}
            </fieldset>
            {draft.cards.map((card, index) => <details className="sportsSheetRole" key={card.role} open>
              <summary>{platformRoles.find(role => role.id === card.role)?.label}</summary>
              <div className="sportsSheetGrid">
                <label className="managerField"><span>Especialidad o modalidad</span><input value={card.specialty} maxLength={120}
                  onChange={event => updateCard(index, { specialty: event.target.value })} /></label>
                <label className="managerField"><span>Categoría</span><input value={card.category} maxLength={80}
                  onChange={event => updateCard(index, { category: event.target.value })} /></label>
                {card.role === 'player' ? <>
                  <label className="managerField"><span>Posiciones</span><input value={card.positions} maxLength={120}
                    placeholder="Ej.: campocorto, segunda base" onChange={event => updateCard(index, { positions: event.target.value })} /></label>
                  <label className="managerField"><span>Dorsal</span><input value={card.number} maxLength={3} inputMode="numeric" pattern="[0-9]{1,3}"
                    onChange={event => updateCard(index, { number: event.target.value })} /></label>
                  <label className="managerField"><span>Batea</span><select value={card.bats} onChange={event => {
                    const value = event.target.value;
                    if (value === '' || value === 'right' || value === 'left' || value === 'switch') updateCard(index, { bats: value });
                  }}><option value="">Sin indicar</option><option value="right">Derecha</option><option value="left">Izquierda</option><option value="switch">Ambas</option></select></label>
                  <label className="managerField"><span>Lanza</span><select value={card.throws} onChange={event => {
                    const value = event.target.value;
                    if (value === '' || value === 'right' || value === 'left') updateCard(index, { throws: value });
                  }}><option value="">Sin indicar</option><option value="right">Derecha</option><option value="left">Izquierda</option></select></label>
                </> : null}
              </div>
              <label className="sportsSheetCheck"><input type="checkbox" checked={card.available}
                onChange={event => updateCard(index, { available: event.target.checked })} />{roleAvailability[card.role]}</label>
            </details>)}
          </section>
          <section className="managerCard managerStepCard"><h2>Mis equipos y ligas actuales</h2>
            <p>Estas pertenencias provienen de los registros de PlaySport; no se añaden manualmente desde la hoja.</p>
            {snapshot.teams.length ? <div className="sportsSheetGrid">{snapshot.teams.map(team => <article className="sportsSheetRole"
              key={JSON.stringify([team.role, team.tournamentId, team.teamId])}><h3>{team.teamName}</h3><p>{team.tournamentName}</p>
              {team.leagueName ? <p>{team.leagueName}</p> : null}<p>{team.role === 'player' ? 'Jugador' : 'Manager'}</p>
              {!team.published ? <p>Asignación privada: no se mostrará en el enlace público.</p> : null}</article>)}</div> :
              <p>{account.identity?.status === 'verified' ? 'Todavía no tienes equipos registrados como jugador o manager.' :
                'Verifica tu identidad en Mi cuenta para vincular tus equipos registrados.'}</p>}
          </section>
          <section className="managerCard managerStepCard"><h2>Privacidad</h2>
            <p>Solo se publica al guardar. Al quitar la publicación y guardar, el enlace deja de mostrar la hoja.</p>
            <div className="sportsSheetChoices">
              {([{ key: 'published', label: 'Publicar mi hoja deportiva al guardar' }, { key: 'photo', label: 'Mostrar mi foto' },
                { key: 'city', label: 'Mostrar mi ciudad deportiva' }, { key: 'teams', label: 'Mostrar mis equipos publicados' },
                { key: 'availability', label: 'Mostrar mi disponibilidad' }] as const).map(item =>
                <label key={item.key}><input type="checkbox" checked={draft.privacy[item.key]}
                  onChange={event => update({ privacy: { ...draft.privacy, [item.key]: event.target.checked } })} />{item.label}</label>)}
            </div>
          </section>
          <details className="managerCard managerStepCard sportsSheetPreview"><summary>Vista previa de lo que verían los demás</summary>
            <p>Esta vista previa no publica ni guarda la hoja.</p>
            <SportsSheetView sheet={projectPublicSportsSheet(draft, { name: account.displayName, photo: account.photo,
              verifiedIdentity: account.identity?.status === 'verified' }, snapshot.teams)} />
          </details>
          <div className="managerButtonRow sportsSheetSave"><button type="submit" className="managerButtonSolid"
            disabled={!changed}>{saving ? 'Guardando…' : draft.privacy.published ? 'Guardar y publicar hoja' : 'Guardar hoja privada'}</button>
            <button type="button" className="managerButtonOutline" onClick={reload}>Recargar versión guardada</button></div>
        </fieldset>
      </form>
      <section className="managerCard managerStepCard"><h2>Próxima etapa</h2>
        <p>Los logros se incorporarán en la siguiente etapa. Los logros y reconocimientos
          se obtendrán exclusivamente de registros oficiales del ecosistema; no habrá carga manual.</p>
      </section>
    </> : null}
  </main>;
}
