import { sportsTheme } from '@playsport/shared';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import BirthDateInput from './birth-date-input';
import {
  matchingFamilyChildren, newMinorRegistration, venezuelaStates,
  type DemoPersonalProfile, type MinorRegistration, type RegistrationClient, type RegistrationFamily
} from '@playsport/shared';

export default function FamilyRegistration({ client, profile, location, onBusy }: {
  client: RegistrationClient; profile: DemoPersonalProfile | null; location: DemoPersonalProfile['location'];
  onBusy: (_busy: boolean) => void; // eslint-disable-line no-unused-vars
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
  const [chooser, setChooser] = useState<'state' | 'municipality' | null>(null);
  const busy = pending > 0;
  const editable = !working && Boolean(profile);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
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
  return <View style={styles.section}>
    <Text style={styles.heading}>Mis hijos o representados</Text>
    <Text>El registro se guarda en la API local; el acceso y el borrador, en este dispositivo. La declaración no verifica parentesco ni tutela.</Text>
    <Text>Sin cédula propia, el sistema asigna la cédula del responsable y -1, -2, -3. Es un número privado de registro, no una cédula. El menor no necesita correo, teléfono ni cuenta propia.</Text>
    {!family ? <Pressable disabled={busy} style={styles.button} onPress={() => setAttempt(value => value + 1)}><Text>Recuperar registro familiar</Text></Pressable> : <>
      <Text>{family.adult ? `Responsable: ${family.adult.fullName} · Registro ${family.adult.identification}` : 'Guarda primero tu perfil para registrar al responsable.'}</Text>
      <Text>Invitación privada de preinscripción del menor</Text><TextInput accessibilityLabel="Invitación privada de preinscripción del menor" value={preRegistrationInvitation}
        editable={editable} maxLength={64} onChangeText={setPreRegistrationInvitation} style={styles.input} />
      <Pressable disabled={busy || !profile} style={styles.button} onPress={() => { void perform(async () => {
        await prepareAdult();
        const value = await client.recoverPreRegistration(preRegistrationInvitation);
        if (!value.isMinor) throw new Error('Esta invitación corresponde a un adulto; debe confirmarla desde su propio perfil.');
        update({ identification: value.identification, fullName: value.fullName, birthDate: value.birthDate, consent: false });
        setPreRegistrationInvitation(''); setNotice('Datos recuperados. Revisa la relación, declara tu autorización y registra al menor para confirmar su mismo ID.');
      }); }}><Text>Recuperar preinscripción del menor</Text></Pressable>
      <Text style={styles.heading}>Agregar hijo o representado</Text>
      <Text>Nombre completo del menor</Text><TextInput accessibilityLabel="Nombre completo del menor" style={styles.input} maxLength={120} editable={editable}
        value={draft.fullName} onChangeText={fullName => update({ fullName })} />
      <BirthDateInput label="Fecha de nacimiento del menor" value={draft.birthDate} editable={editable} onChange={birthDate => update({ birthDate })} />
      <Text>Cédula propia del menor (opcional)</Text><TextInput accessibilityLabel="Cédula propia del menor" style={styles.input} maxLength={20} editable={editable}
        value={draft.identification} autoCapitalize="characters" placeholder="Vacía si no tiene" onChangeText={identification => update({ identification })} />
      <Text>Mi relación con el menor</Text>
      <View style={styles.options}>{([['father', 'Padre'], ['mother', 'Madre'], ['guardian', 'Representante autorizado']] as const).map(([relationship, label]) =>
        <Pressable key={relationship} accessibilityRole="radio" accessibilityState={{ checked: draft.relationship === relationship }} disabled={!editable} style={styles.button}
          onPress={() => update({ relationship })}><Text>{draft.relationship === relationship ? '✓ ' : ''}{label}</Text></Pressable>)}</View>
      <Text>Estado del menor</Text><Pressable disabled={!editable} style={styles.button} onPress={() => setChooser(chooser === 'state' ? null : 'state')}><Text>{state?.name}</Text></Pressable>
      {chooser === 'state' ? venezuelaStates.filter(item => item.municipalities.length).map(item =>
        <Pressable key={item.id} disabled={!editable} style={styles.button} onPress={() => { update({ location: { stateId: item.id, municipalityId: item.municipalities[0].id } }); setChooser(null); }}><Text>{item.name}</Text></Pressable>) : null}
      <Text>Municipio del menor</Text><Pressable disabled={!editable} style={styles.button} onPress={() => setChooser(chooser === 'municipality' ? null : 'municipality')}><Text>{state?.municipalities.find(item => item.id === draft.location.municipalityId)?.name}</Text></Pressable>
      {chooser === 'municipality' ? state?.municipalities.map(item =>
        <Pressable key={item.id} disabled={!editable} style={styles.button} onPress={() => { update({ location: { ...draft.location, municipalityId: item.id } }); setChooser(null); }}><Text>{item.name}</Text></Pressable>) : null}
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: draft.consent }} disabled={!editable} style={styles.button} onPress={() => update({ consent: !draft.consent })}>
        <Text>{draft.consent ? '✓ ' : ''}Declaro que tengo autorización para representar e inscribir al menor.</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy || !profile} style={styles.button} onPress={() => { void perform(async () => {
        await prepareAdult(); setFamily(await client.addMinor(current.current));
        const empty = newMinorRegistration(profile!.location); current.current = empty; setDraft(empty);
        setNotice('Menor registrado. Su identificador e historial son permanentes.'); await client.draft(empty);
      }); }}><Text>Registrar menor</Text></Pressable>
      <Text>Buscar por registro, nombre o cédula del representante</Text><TextInput accessibilityLabel="Buscar representados" style={styles.input} value={search} maxLength={120} onChangeText={setSearch} />
      <Text>{family.children.length} representado(s). El registro, el nacimiento y los contactos no se publican en las pizarras, ni con un plan de pago.</Text>
      {matchingFamilyChildren(family, search).map(child => <View key={child.id} style={styles.section}>
        <Text style={styles.heading}>{child.fullName}</Text><Text>Número de registro: {child.registrationNumber}</Text>
        <Text>{child.identification ? 'Con cédula propia.' : 'Sin cédula propia. Código asignado por el sistema.'}</Text>
        {child.registrationAliases.length ? <Text>Referencia anterior: {child.registrationAliases.join(', ')}</Text> : null}
        <Text>Identificador permanente: {child.id}</Text>
        {!child.identification ? <>
          <Text>Incorporar su cédula cuando la obtenga</Text><TextInput accessibilityLabel={`Cédula de ${child.fullName}`} style={styles.input} maxLength={20} editable={!working}
            value={documents[child.id] ?? ''} autoCapitalize="characters" onChangeText={value => setDocuments(previous => ({ ...previous, [child.id]: value }))} />
          <Pressable disabled={busy} style={styles.button} onPress={() => { void perform(async () => {
            setFamily(await client.addDocument(child.id, documents[child.id] ?? '')); setNotice('Cédula incorporada al mismo jugador. El código anterior sigue siendo consultable.');
          }); }}><Text>Incorporar cédula sin perder historial</Text></Pressable>
        </> : null}
        <Text>Cambiar representante sin renumerar al jugador: el nuevo adulto debe guardar su perfil y aceptar una invitación.</Text>
        <TextInput accessibilityLabel={`Cédula del nuevo responsable de ${child.fullName}`} style={styles.input} maxLength={20} editable={!working}
          value={destinations[child.id] ?? ''} placeholder="Cédula del nuevo responsable" onChangeText={value => setDestinations(previous => ({ ...previous, [child.id]: value }))} />
        <Pressable disabled={busy} style={styles.button} onPress={() => { void perform(async () => {
          setInvitation(await client.inviteTransfer(child.id, destinations[child.id] ?? '')); setNotice('Invitación válida siete días. Compártela solo con el nuevo responsable.');
        }); }}><Text>Crear invitación de cambio de representante</Text></Pressable>
      </View>)}
      {family.children.length > 0 && matchingFamilyChildren(family, search).length === 0 ? <Text>No hay representados que coincidan.</Text> : null}
      <Text style={styles.heading}>Vincular un menor ya registrado</Text>
      <Text>No lo inscribas de nuevo. Solicita una invitación a su representante actual y declara tu autorización.</Text>
      <TextInput accessibilityLabel="Invitación del representante actual" style={styles.input} maxLength={64} editable={editable} autoCapitalize="none" value={receivedInvitation} onChangeText={setReceivedInvitation} />
      <Text>Mi relación con el menor ya registrado</Text>
      <View style={styles.options}>{([['father', 'Padre'], ['mother', 'Madre'], ['guardian', 'Representante autorizado']] as const).map(([relationship, label]) =>
        <Pressable key={relationship} accessibilityRole="radio" accessibilityState={{ checked: transferRelationship === relationship }} disabled={!editable} style={styles.button}
          onPress={() => setTransferRelationship(relationship)}><Text>{transferRelationship === relationship ? '✓ ' : ''}{label}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: transferConsent }} disabled={!editable} style={styles.button} onPress={() => setTransferConsent(value => !value)}>
        <Text>{transferConsent ? '✓ ' : ''}Declaro que estoy autorizado para asumir esta representación.</Text>
      </Pressable>
      <Pressable disabled={busy || !profile} style={styles.button} onPress={() => { void perform(async () => {
        await prepareAdult(); setFamily(await client.acceptTransfer(receivedInvitation.trim(), transferRelationship, transferConsent)); setReceivedInvitation(''); setTransferConsent(false); setNotice('Representación vinculada al mismo jugador, sin renumerarlo.');
      }); }}><Text>Aceptar representación del menor existente</Text></Pressable>
    </>}
    {invitation ? <Text selectable>Invitación privada: {invitation}</Text> : null}
    {busy ? <Text>Guardando registro…</Text> : null}
    {error ? <Text accessibilityRole="alert">{error} Puedes reintentar sin borrar el perfil ni el historial.</Text> : null}
    {notice ? <Text accessibilityRole="alert">{notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: 12, padding: 12, borderWidth: 1, borderColor: sportsTheme.muted, borderRadius: 8 },
  heading: { fontSize: 20, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: sportsTheme.muted, borderRadius: 8, padding: 12, color: sportsTheme.text, backgroundColor: sportsTheme.surface },
  button: { minHeight: 44, borderWidth: 1, borderColor: sportsTheme.muted, padding: 12, borderRadius: 8, backgroundColor: sportsTheme.surface },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }
});
