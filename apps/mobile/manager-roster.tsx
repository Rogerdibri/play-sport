import { sportsTheme } from '@playsport/shared';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import BirthDateInput from './birth-date-input';
import {
  RosterClient, isCalendarDate, isRosterRole, newPreRegistration, normalizeProfileIdentification, registrationAge, rosterRoleLabels, rosterGroups, rosterGroup,
  type ManagerRoster as RosterSnapshot, type ManagerRosterTeam, type PreRegistration, type RosterPerson, type RosterRole
} from '@playsport/shared';

const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación del roster.';
export default function ManagerRoster({ apiBase, managerId, teamId, tournamentId, disabled, onBusy }: {
  apiBase: string; managerId: string; teamId: string; tournamentId: string; disabled: boolean; onBusy: (_busy: boolean) => void; // eslint-disable-line no-unused-vars
}) {
  const client = useMemo(() => new RosterClient(apiBase.replace(/\/official-scoring\/?$/, ''), managerId), [apiBase, managerId]);
  const [teams, setTeams] = useState<ManagerRosterTeam[] | null>(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setTeams(null); setError('');
    void client.teams().then(value => { if (active) setTeams(value); })
      .catch(failure => { if (active) setError(message(failure)); });
    return () => { active = false; };
  }, [client, attempt]);
  const selected = teams?.find(team => team.teamId === teamId && team.tournamentId === tournamentId);
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.hero}><Text style={styles.heroTitle}>ROSTER</Text>
      {selected ? <><Text style={styles.heroTitle}>{selected.teamName}</Text><Text style={styles.heroText}>{selected.tournamentName}</Text></> : null}
      <Text style={styles.heroText}>Tu equipo de trabajo</Text></View>
    {!teams && !error ? <Text>Consultando tus equipos…</Text> : null}
    {error ? <><Text accessibilityRole="alert">{error}</Text><Pressable disabled={disabled} onPress={() => setAttempt(value => value + 1)} style={styles.button}><Text>Reintentar</Text></Pressable></> : null}
    {teams && !selected && !error ? <Text accessibilityRole="alert">El equipo elegido no está asignado a este manager en este torneo. Revisa tu contexto de trabajo.</Text> : null}
    {selected ? <RosterEditor key={`${selected.tournamentId}:${selected.teamId}`} client={client} team={selected} disabled={disabled} onBusy={onBusy} /> : null}
  </ScrollView>;
}
export function RosterEditor({ client, team, disabled, onBusy }: {
  client: RosterClient; team: ManagerRosterTeam; disabled: boolean; onBusy: (_busy: boolean) => void; // eslint-disable-line no-unused-vars
}) {
  const [roster, setRoster] = useState<RosterSnapshot | null>(null), [person, setPerson] = useState<RosterPerson | null>(null);
  const [query, setQuery] = useState(''), [role, setRole] = useState<RosterRole>('PLAYER');
  const [draft, setDraft] = useState(newPreRegistration), [missing, setMissing] = useState(false);
  const [working, setWorking] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [attempt, setAttempt] = useState(0);
  const [invitation, setInvitation] = useState('');
  const [refreshError, setRefreshError] = useState('');
  useEffect(() => { onBusy(working); return () => onBusy(false); }, [working, onBusy]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void client.load(team).then(value => { if (active) setRoster(value); }).catch(failure => { if (active) setError(message(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, team, attempt]);
  useEffect(() => {
    let active = true;
    const timer = setInterval(() => {
      if (working) return;
      void client.load(team).then(value => { if (active) { setRoster(value); setRefreshError(''); } })
        .catch(failure => { if (active) setRefreshError(message(failure)); });
    }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [client, team, working]);
  const perform = async (action: () => Promise<void>) => {
    setWorking(true); setError(''); setNotice('');
    try { await action(); } catch (failure) { setError(message(failure)); } finally { setWorking(false); }
  };
  const reset = () => { setPerson(null); setMissing(false); setQuery(''); setDraft(newPreRegistration()); };
  const update = (key: keyof PreRegistration, value: string) => setDraft(previous => ({ ...previous, [key]: value }));
  const blocked = disabled || working || loading || !roster;
  const capacity = roster?.admission?.groups[rosterGroup(role)];
  const full = capacity?.limit !== null && capacity?.limit !== undefined && capacity.used >= capacity.limit;
  const admissionBlocked = roster?.admission?.closed || full;
  const minor = isCalendarDate(draft.birthDate) && draft.birthDate <= new Date().toISOString().slice(0, 10) && registrationAge(draft.birthDate) < 18;
  return <View style={styles.content}>
    {loading ? <Text>Consultando el roster…</Text> : null}{error ? <Text accessibilityRole="alert">{error}</Text> : null}{notice ? <Text>{notice}</Text> : null}
    {refreshError ? <Text accessibilityRole="alert">No se pudo actualizar el cierre: {refreshError}</Text> : null}
    <Text style={styles.heading}>Plantilla del equipo</Text>
    <Text>{roster?.members.length ?? 0} integrantes · No es el lineup de un partido</Text>
    {roster ? rosterGroups.map(group => {
      const members = roster.members.filter(row => group.roles.some(role => role === row.role));
      return <View key={group.title} style={styles.group}><Text style={styles.groupTitle}>{group.title} · {members.length}{roster.admission?.groups[group.id].limit !== null && roster.admission?.groups[group.id].limit !== undefined ? ` / ${roster.admission.groups[group.id].limit}` : ''}</Text>
        {!members.length ? <Text>Sin integrantes en esta sección.</Text> : null}
        {members.map(row => <View key={row.person.id} style={styles.card}>
          <Text style={styles.personName}>{row.person.fullName}</Text><Text>{row.person.identification || row.person.id}</Text><Text>{rosterRoleLabels[row.role]}</Text>
          <Text>{row.person.registrationStatus === 'preinscribed' ? 'Preinscrito · Pendiente de confirmación' : row.person.registrationStatus === 'registered' ? 'Registrado' : 'Registro deportivo existente'}</Text>
          <Text>{row.addedBy === 'manager' ? 'Incorporado por el manager' : 'En el roster'}</Text>
          {row.canInvite ? <Pressable disabled={disabled || working} style={styles.button} onPress={() => { void perform(async () => {
            setInvitation(await client.invite(team, row.person.id));
            setNotice(`Invitación privada para ${row.person.fullName}. Compártela solo con la persona o su representante.`);
          }); }}><Text>Generar invitación privada · {row.person.fullName}</Text></Pressable> : null}
        </View>)}
      </View>;
    }) : null}
    <Pressable disabled={disabled || working || loading} style={styles.button} onPress={() => setAttempt(value => value + 1)}><Text>Actualizar roster</Text></Pressable>
    {invitation ? <><Text>Invitación privada de preinscripción</Text><Text selectable>{invitation}</Text>
      <Text>Caduca en siete días. Se introduce en Mi perfil o, para menores, en Mis hijos o representados. No se envió ningún mensaje.</Text></> : null}
    <Text style={styles.heading}>Incorporar una persona</Text>
    {roster?.admission ? <Text>{roster.admission.closed ? 'INCORPORACIONES CERRADAS. ' : 'Incorporaciones abiertas. '}{roster.admission.reason}</Text> : null}
    <Text>El manager incorpora directamente dentro de los cupos, sin aprobación individual del organizador.</Text>
    <Text>Cédula o ID de la persona</Text><TextInput accessibilityLabel="Cédula o ID de la persona" value={query} editable={!blocked} maxLength={120} style={styles.input}
      onChangeText={value => { setQuery(value); setPerson(null); setMissing(false); }} />
    <Pressable accessibilityRole="button" disabled={blocked} style={styles.button} onPress={() => { void perform(async () => {
      const found = await client.lookup(team, query); setPerson(found); setMissing(!found);
      if (!found) setDraft({ ...newPreRegistration(), identification: normalizeProfileIdentification(query) });
    }); }}><Text>Buscar en el ecosistema</Text></Pressable>
    <Pressable disabled={blocked} style={styles.button} onPress={() => { reset(); setMissing(true); }}><Text>Preinscribir menor sin cédula</Text></Pressable>
    {person ? <Text>{person.fullName} · {person.identification || person.id} · {person.registrationStatus === 'preinscribed' ? 'Pendiente de confirmación' : 'Registro existente'}</Text> : null}
    {missing ? <View style={styles.content}>
      <Text style={styles.heading}>Preinscripción mínima</Text>
      <Text>Nombre, apellido y nacimiento obligatorios; correo o teléfono, al menos uno. Para menores, el contacto es del representante.</Text>
      {([
        ['identification', 'Cédula de la preinscripción'], ['fullName', 'Nombre y apellido'], ['birthDate', 'Fecha de nacimiento de la persona'],
        ['email', minor ? 'Correo del representante' : 'Correo de contacto'], ['phone', minor ? 'Teléfono del representante' : 'Teléfono de contacto'],
        ...(minor ? [['representativeIdentification', 'Cédula del representante']] as const : [])
      ] as const).map(([field, label]) => field === 'birthDate' ?
        <BirthDateInput key={field} label={label} value={draft.birthDate} editable={!blocked} onChange={value => update('birthDate', value)} /> :
        <View key={field}><Text>{label}</Text><TextInput accessibilityLabel={label} editable={!blocked} value={draft[field]}
        maxLength={field === 'fullName' ? 120 : field === 'email' ? 254 : 30} style={styles.input}
        keyboardType={field === 'email' ? 'email-address' : field === 'phone' ? 'phone-pad' : 'default'}
        autoCapitalize={field === 'email' ? 'none' : 'sentences'} onChangeText={value => update(field, value)} /></View>)}
      <Text>Los menores sin cédula conservan un ID propio; no se crea una cuenta ni se confirma su representación.</Text>
    </View> : null}
    {person || missing ? <>
      <Text style={styles.heading}>Cargo en el equipo</Text>
      {Object.entries(rosterRoleLabels).map(([id, label]) => <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: role === id }}
        disabled={blocked} style={styles.button} onPress={() => { if (isRosterRole(id)) setRole(id); }}><Text>{role === id ? '✓ ' : ''}{label}</Text></Pressable>)}
      {full ? <Text>Este grupo agotó su cupo. Puedes elegir otro cargo de un grupo con disponibilidad.</Text> : null}
      <Pressable accessibilityRole="button" disabled={blocked || Boolean(admissionBlocked)} style={styles.button} onPress={() => { void perform(async () => {
        setRoster(person ? await client.add(team, role, person.id) : await client.preinscribe(team, role, draft));
        reset(); setNotice('Persona incorporada directamente al roster. Si fue preinscrita, solo queda pendiente la confirmación personal.');
      }); }}><Text>{person ? 'Añadir al roster' : 'Guardar preinscripción y añadir al roster'}</Text></Pressable>
    </> : null}
    <Text>La categoría depende del reglamento y de su fecha de corte. El cargo no concede permisos de cuenta. Nacimiento y contactos no se publican.</Text>
    <Text>La confirmación personal se realiza desde Mi perfil o el registro del representante. Titulares, suplentes y posiciones defensivas se eligen únicamente en el lineup.</Text>
    <Text>El registro no verifica identidad, contacto ni tutela.</Text>
  </View>;
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 }, title: { fontSize: 26, fontWeight: '700' }, heading: { fontSize: 20, fontWeight: '700' },
  hero: { padding: 20, borderRadius: 18, backgroundColor: sportsTheme.ink, gap: 8 },
  heroTitle: { fontSize: 24, fontWeight: '700', color: sportsTheme.onDark }, heroText: { color: sportsTheme.mutedOnDark },
  group: { gap: 8 }, groupTitle: { padding: 10, backgroundColor: sportsTheme.surfaceAlt, color: sportsTheme.text, fontWeight: '700' },
  personName: { fontWeight: '700', fontSize: 16 },
  button: { borderWidth: 1, borderColor: sportsTheme.muted, padding: 12, borderRadius: 8, backgroundColor: sportsTheme.surface },
  input: { borderWidth: 1, borderColor: sportsTheme.muted, padding: 12, borderRadius: 8, backgroundColor: sportsTheme.surface, color: sportsTheme.text },
  card: { padding: 12, borderWidth: 1, borderColor: '#c6d6df', borderRadius: 8, gap: 8 }
});
