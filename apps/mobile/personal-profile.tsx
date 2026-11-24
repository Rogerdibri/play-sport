import { sportsTheme } from '@playsport/shared';
import { useEffect, useRef, useState } from 'react';
import { Image, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import {
  DemoProfileStore, RegistrationClient, demoProfileLocation, newDemoPersonalProfile, profilePhotoMaxLength,
  socialNetworks, venezuelaStates, type DemoPersonalProfile
} from '@playsport/shared';
import FamilyRegistration from './family-registration';
import BirthDateInput from './birth-date-input';
import { mobileApiBase } from './service-origins';

export default function PersonalProfile({ accountId, onBack, onBusy }: {
  accountId: string; onBack: () => void; onBusy: (_busy: boolean) => void; // eslint-disable-line no-unused-vars
}) {
  const store = useRef(new DemoProfileStore(AsyncStorage));
  const registry = useRef(new RegistrationClient(mobileApiBase, accountId, AsyncStorage));
  const [savedProfile, setSavedProfile] = useState<DemoPersonalProfile | null>(null);
  const [familyBusy, setFamilyBusy] = useState(false);
  const [draft, setDraft] = useState(() => newDemoPersonalProfile(accountId, demoProfileLocation));
  const current = useRef(draft);
  const [loaded, setLoaded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pending, setPending] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [invitation, setInvitation] = useState('');
  const [chooser, setChooser] = useState<'state' | 'municipality' | null>(null);
  const busy = pending > 0 || photoBusy || familyBusy;
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => {
    let active = true;
    void store.current.load().then(document => {
      if (!active) return;
      const saved = document.saved.find(profile => profile.accountId === accountId);
      const value = document.drafts.find(profile => profile.accountId === accountId) ?? saved ?? newDemoPersonalProfile(accountId, demoProfileLocation);
      current.current = value; setDraft(value); setSavedProfile(saved ?? null); setLocked(Boolean(saved)); setLoaded(true); setError('');
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'No se pudo recuperar el perfil.'); });
    return () => { active = false; };
  }, [accountId, attempt]);
  const update = (patch: Partial<DemoPersonalProfile>) => {
    const value = { ...current.current, ...patch };
    current.current = value; setDraft(value); setNotice(''); setPending(count => count + 1);
    void store.current.draft(value).then(() => setError('')).catch(failure => {
      setError(failure instanceof Error ? failure.message : 'No se pudo conservar el borrador.');
    }).finally(() => setPending(count => count - 1));
  };
  const save = async () => {
    setCommitting(true); setPending(count => count + 1); setError(''); setNotice('');
    try {
      await store.current.draft(current.current);
      const document = await store.current.save(accountId);
      const saved = document.saved.find(profile => profile.accountId === accountId);
      if (!saved) throw new Error('No se pudo confirmar el perfil guardado.');
      current.current = saved; setDraft(saved); setLocked(true);
      await registry.current.saveAdult(saved);
      setSavedProfile(saved);
      setNotice('Perfil guardado: registro obligatorio en la API local y datos complementarios en este dispositivo.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar el perfil.'); }
    finally { setCommitting(false); setPending(count => count - 1); }
  };
  const pickPhoto = async () => {
    setPhotoBusy(true); setError('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Permite el acceso a tus fotos para elegir una imagen.');
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset || asset.type !== 'image') throw new Error('Selecciona una imagen.');
      if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) throw new Error('Elige una imagen de hasta 5 MB.');
      const image = await manipulateAsync(asset.uri, [{ resize: { width: 640 } }], { compress: 0.75, format: SaveFormat.JPEG, base64: true });
      if (!image.base64) throw new Error('No se pudo preparar la foto.');
      const photo = `data:image/jpeg;base64,${image.base64}`;
      if (photo.length > profilePhotoMaxLength) throw new Error('La foto sigue siendo muy pesada. Elige otra imagen.');
      update({ photo });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo cargar la foto.'); }
    finally { setPhotoBusy(false); }
  };
  const state = venezuelaStates.find(item => item.id === draft.location.stateId);
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Pressable accessibilityRole="button" disabled={busy} onPress={onBack} style={styles.button}><Text>Volver atrás</Text></Pressable>
    <Text style={styles.title}>Mi perfil</Text>
    <Pressable accessibilityRole="link" disabled={busy} style={styles.button} onPress={() => {
      void Linking.openURL(`${process.env.EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN ?? 'http://localhost:3000'}/wallet`)
        .catch(() => setError('No se pudo abrir tu billetera en la web. Vuelve a intentarlo.'));
    }}><Text>Mi billetera única · abrir en la web</Text></Pressable>
    <Text>El registro obligatorio se guarda en la API local; la foto, los datos complementarios y el acceso privado, en este dispositivo.
      No hay verificación de identidad, correo ni tutela.</Text>
    {!loaded ? <>
      {error ? <><Text accessibilityRole="alert">{error}</Text><Pressable onPress={() => setAttempt(value => value + 1)} style={styles.button}><Text>Reintentar</Text></Pressable></> :
        <Text>Recuperando tu perfil y su borrador…</Text>}
    </> : <>
      <Text style={styles.title}>Recuperar mi preinscripción</Text>
      <Text>Usa la invitación privada del manager para recuperar los datos, revisarlos y guardar el mismo registro. Para menores, usa el apartado del representante.</Text>
      <TextInput accessibilityLabel="Invitación privada de mi preinscripción" value={invitation} maxLength={64} editable={!busy} style={styles.input} onChangeText={setInvitation} />
      <Pressable disabled={busy} style={styles.button} onPress={() => { void (async () => {
        setCommitting(true); setPending(value => value + 1); setError(''); setNotice('');
        try {
          const value = await registry.current.recoverPreRegistration(invitation);
          if (value.isMinor) throw new Error('Recupera esta preinscripción desde Mis hijos o representados del responsable.');
          if (locked && current.current.identification !== value.identification) throw new Error('La invitación corresponde a otra cédula; no se sustituyó el perfil.');
          update({ identification: value.identification, fullName: value.fullName, birthDate: value.birthDate, email: value.email, phone: value.phone });
          setInvitation(''); setNotice('Datos recuperados. Revísalos y guarda el perfil para confirmar la misma identidad.');
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo recuperar la preinscripción.'); }
        finally { setCommitting(false); setPending(value => value - 1); }
      })(); }}><Text>Recuperar datos preinscritos</Text></Pressable>
      {draft.photo ? <Image source={{ uri: draft.photo }} style={styles.photo} accessibilityLabel="Foto del perfil" /> : <Text>Sin foto de perfil</Text>}
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void pickPhoto(); }} style={styles.button}><Text>Cargar foto de perfil</Text></Pressable>
      {draft.photo ? <Pressable disabled={busy} onPress={() => update({ photo: '' })} style={styles.button}><Text>Quitar foto</Text></Pressable> : null}
      <Text>Cédula de prueba {locked ? '(fija)' : '(V-12345678 o E-12345678)'}</Text>
      <TextInput accessibilityLabel="Cédula de prueba" value={draft.identification} editable={!locked && !photoBusy && !committing} maxLength={20}
        onChangeText={identification => update({ identification })} style={styles.input} autoCapitalize="characters" />
      <Text>Nombre completo</Text><TextInput accessibilityLabel="Nombre completo" value={draft.fullName} editable={!photoBusy && !committing} maxLength={120}
        onChangeText={fullName => update({ fullName })} style={styles.input} />
      <BirthDateInput label="Fecha de nacimiento" value={draft.birthDate} editable={!photoBusy && !committing} onChange={birthDate => update({ birthDate })} />
      <Text>Correo electrónico</Text><TextInput accessibilityLabel="Correo electrónico" value={draft.email} editable={!photoBusy && !committing} maxLength={254}
        keyboardType="email-address" autoCapitalize="none" autoCorrect={false} onChangeText={email => update({ email })} style={styles.input} />
      <Text>Teléfono</Text><TextInput accessibilityLabel="Teléfono" value={draft.phone} editable={!photoBusy && !committing} maxLength={30} keyboardType="phone-pad"
        onChangeText={phone => update({ phone })} style={styles.input} />
      <Text>Sexo</Text><View style={styles.options}>{([
        ['female', 'Femenino'], ['male', 'Masculino'], ['not-specified', 'Prefiero no indicarlo'], ['', 'Sin indicar']
      ] as const).map(([sex, label]) => <Pressable key={sex} accessibilityRole="radio" accessibilityState={{ checked: draft.sex === sex }}
        disabled={photoBusy || committing} onPress={() => update({ sex })} style={styles.button}><Text>{draft.sex === sex ? '✓ ' : ''}{label}</Text></Pressable>)}</View>
      <Text>Estado</Text><Pressable disabled={photoBusy || committing} style={styles.button} onPress={() => setChooser(chooser === 'state' ? null : 'state')}><Text>{state?.name}</Text></Pressable>
      {chooser === 'state' ? venezuelaStates.filter(item => item.municipalities.length).map(item => <Pressable key={item.id} disabled={photoBusy || committing} style={styles.button}
        onPress={() => { update({ location: { stateId: item.id, municipalityId: item.municipalities[0].id } }); setChooser(null); }}><Text>{item.name}</Text></Pressable>) : null}
      <Text>Municipio</Text><Pressable disabled={photoBusy || committing} style={styles.button} onPress={() => setChooser(chooser === 'municipality' ? null : 'municipality')}>
        <Text>{state?.municipalities.find(item => item.id === draft.location.municipalityId)?.name}</Text></Pressable>
      {chooser === 'municipality' ? state?.municipalities.map(item => <Pressable key={item.id} disabled={photoBusy || committing} style={styles.button}
        onPress={() => { update({ location: { ...draft.location, municipalityId: item.id } }); setChooser(null); }}><Text>{item.name}</Text></Pressable>) : null}
      <Text>Dirección detallada</Text><TextInput accessibilityLabel="Dirección detallada" value={draft.address} editable={!photoBusy && !committing} multiline maxLength={300}
        onChangeText={address => update({ address })} style={styles.input} />
      <Text>Redes sociales (enlaces https:// opcionales)</Text>
      {socialNetworks.map(network => <View key={network}><Text>{network === 'x' ? 'X / Twitter' : network}</Text>
        <TextInput accessibilityLabel={network} value={draft.social[network]} editable={!photoBusy && !committing} maxLength={500} autoCapitalize="none" autoCorrect={false} keyboardType="url"
          onChangeText={value => update({ social: { ...current.current.social, [network]: value } })} style={styles.input} />
      </View>)}
      <Text>Obligatorios: cédula, nombre y apellido, fecha de nacimiento, estado, municipio y al menos un contacto: correo electrónico o teléfono. Puedes indicar ambos. La cédula queda fija al guardar. No cambia permisos ni rosters.</Text>
      <Text>Identificador técnico de prueba: {draft.id}</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void save(); }} style={styles.button}><Text>Guardar perfil</Text></Pressable>
      <FamilyRegistration client={registry.current} profile={savedProfile} location={demoProfileLocation} onBusy={setFamilyBusy} />
    </>}
    {busy ? <Text>Guardando o preparando la foto…</Text> : null}
    {error && loaded ? <Text accessibilityRole="alert">{error} Tus cambios permanecen en pantalla; vuelve a guardar.</Text> : null}
    {notice ? <Text accessibilityRole="alert">{notice}</Text> : null}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f8fa' }, content: { padding: 20, gap: 12 },
  title: { fontSize: 26, fontWeight: '700' }, photo: { width: 112, height: 112, borderRadius: 56 },
  input: { borderWidth: 1, borderColor: sportsTheme.muted, borderRadius: 8, padding: 12, color: sportsTheme.text, backgroundColor: sportsTheme.surface },
  button: { borderWidth: 1, borderColor: sportsTheme.muted, padding: 12, borderRadius: 8, backgroundColor: sportsTheme.surface },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }
});
