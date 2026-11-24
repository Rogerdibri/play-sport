import { sportsTheme } from '@playsport/shared';
import { useRef } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { registrationAge } from '@playsport/shared';

export default function BirthDateInput({ label, value, onChange, editable = true }: {
  label: string; value: string; editable?: boolean;
  onChange: (_value: string) => void; // eslint-disable-line no-unused-vars
}) {
  const dayRef = useRef<TextInput>(null), monthRef = useRef<TextInput>(null), yearRef = useRef<TextInput>(null);
  const [year = '', month = '', day = ''] = value.split('-');
  const parts = [day, month, year], refs = [dayRef, monthRef, yearRef];
  const labels = ['Día', 'Mes', 'Año'], placeholders = ['DD', 'MM', 'AAAA'];
  const patterns = [/^(0[1-9]|[12][0-9]|3[01])$/, /^(0[1-9]|1[0-2])$/, /^\d{4}$/];
  let error = '';
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] && (/\D/.test(parts[index]) || parts[index].length === (index === 2 ? 4 : 2) && !patterns[index].test(parts[index]))) {
      error = `Revisa ${labels[index].toLocaleLowerCase('es')}: introduce ${index === 2 ? 'cuatro dígitos' : index === 0 ? 'un día entre 01 y 31' : 'un mes entre 01 y 12'}.`;
      break;
    }
  }
  if (!error && day.length === 2 && month.length === 2 && year.length === 4) {
    try { registrationAge(value); }
    catch (failure) { error = failure instanceof Error ? failure.message : 'Revisa la fecha de nacimiento.'; }
  }
  const update = (index: number, text: string) => {
    const next = [...parts]; next[index] = text;
    onChange(next.every(part => part === '') ? '' : `${next[2]}-${next[1]}-${next[0]}`);
  };
  return <View style={styles.field}>
    <Text>{label}</Text>
    <View style={styles.segments}>{parts.map((part, index) => <View key={labels[index]} style={index === 2 ? styles.year : styles.segment}>
      <Text>{labels[index]}</Text><TextInput ref={refs[index]} accessibilityLabel={`${label}: ${labels[index].toLocaleLowerCase('es')}`}
        value={part} editable={editable} maxLength={index === 2 ? 4 : 2} keyboardType="number-pad" selectTextOnFocus
        placeholder={placeholders[index]} style={styles.input} autoCorrect={false}
        returnKeyType={index === 2 ? 'done' : 'next'} blurOnSubmit={index === 2}
        onChangeText={text => {
          const completed = index < 2 && /^\d$/.test(text) && Number(text) > (index === 0 ? 3 : 1) ? text.padStart(2, '0') : text;
          update(index, completed); if (index < 2 && patterns[index].test(completed)) refs[index + 1].current?.focus();
        }}
        onEndEditing={event => {
          const text = event.nativeEvent.text;
          if (index < 2 && /^[1-9]$/.test(text)) update(index, text.padStart(2, '0'));
        }}
        onSubmitEditing={() => { if (index < 2) refs[index + 1].current?.focus(); }}
        onKeyPress={event => { if (event.nativeEvent.key === 'Backspace' && !part && index > 0) refs[index - 1].current?.focus(); }} />
    </View>)}</View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  field: { gap: 6 }, segments: { flexDirection: 'row', gap: 10 },
  segment: { flex: 1, gap: 4 }, year: { flex: 1.5, gap: 4 },
  input: { borderWidth: 1, borderColor: sportsTheme.muted, padding: 12, borderRadius: 8, backgroundColor: sportsTheme.surface, color: sportsTheme.text, textAlign: 'center' },
  error: { color: '#9b2525' }
});
