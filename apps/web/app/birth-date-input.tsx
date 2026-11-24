'use client';

import { useEffect, useId, useRef, type ComponentRef } from 'react';
import { registrationAge } from '@playsport/shared';

export default function BirthDateInput({ label, value, onChange, disabled = false }: {
  label: string; value: string; disabled?: boolean;
  onChange: (_value: string) => void; // eslint-disable-line no-unused-vars
}) {
  const id = useId();
  const dayRef = useRef<ComponentRef<'input'>>(null), monthRef = useRef<ComponentRef<'input'>>(null), yearRef = useRef<ComponentRef<'input'>>(null);
  const [year = '', month = '', day = ''] = value.split('-');
  const parts = [day, month, year], refs = [dayRef, monthRef, yearRef];
  const labels = ['Día', 'Mes', 'Año'], placeholders = ['DD', 'MM', 'AAAA'];
  const patterns = ['(0[1-9]|[12][0-9]|3[01])', '(0[1-9]|1[0-2])', '[0-9]{4}'];
  let error = '';
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] && (/\D/.test(parts[index]) || parts[index].length === (index === 2 ? 4 : 2) && !new RegExp(`^${patterns[index]}$`).test(parts[index]))) {
      error = `Revisa ${labels[index].toLocaleLowerCase('es')}: introduce ${index === 2 ? 'cuatro dígitos' : index === 0 ? 'un día entre 01 y 31' : 'un mes entre 01 y 12'}.`;
      break;
    }
  }
  if (!error && day.length === 2 && month.length === 2 && year.length === 4) {
    try { registrationAge(value); }
    catch (failure) { error = failure instanceof Error ? failure.message : 'Revisa la fecha de nacimiento.'; }
  }
  useEffect(() => { yearRef.current?.setCustomValidity(error); }, [error]);
  const update = (index: number, text: string) => {
    const next = [...parts]; next[index] = text;
    onChange(next.every(part => part === '') ? '' : `${next[2]}-${next[1]}-${next[0]}`);
  };
  return <fieldset className="birthDateField" disabled={disabled}>
    <legend>{label}</legend>
    <div className="birthDateSegments">{parts.map((part, index) => <label className="managerField" key={labels[index]}>
      <span>{labels[index]}</span>
      <input ref={refs[index]} type="text" inputMode="numeric" required maxLength={index === 2 ? 4 : 2}
        pattern={patterns[index]} placeholder={placeholders[index]} value={part}
        aria-label={`${label}: ${labels[index].toLocaleLowerCase('es')}`} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
        autoComplete={index === 0 ? 'bday-day' : index === 1 ? 'bday-month' : 'bday-year'}
        onFocus={event => event.currentTarget.select()}
        onChange={event => {
          const text = event.currentTarget.value;
          const completed = index < 2 && /^\d$/.test(text) && Number(text) > (index === 0 ? 3 : 1) ? text.padStart(2, '0') : text;
          update(index, completed);
          if (index < 2 && new RegExp(`^${patterns[index]}$`).test(completed)) { refs[index + 1].current?.focus(); refs[index + 1].current?.select(); }
        }}
        onBlur={event => {
          const text = event.currentTarget.value;
          if (index < 2 && /^[1-9]$/.test(text)) update(index, text.padStart(2, '0'));
        }}
        onKeyDown={event => {
          if (event.key === 'Backspace' && !part && index > 0) { event.preventDefault(); refs[index - 1].current?.focus(); refs[index - 1].current?.select(); }
        }}
        onPaste={event => {
          const text = event.clipboardData.getData('text').trim();
          const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text), local = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
          const pasted = iso ? text : local ? `${local[3]}-${local[2]}-${local[1]}` : null;
          if (pasted) {
            event.preventDefault(); onChange(pasted);
            yearRef.current?.focus(); yearRef.current?.select();
          }
        }} />
    </label>)}</div>
    {error ? <p className="birthDateError" id={`${id}-error`} role="alert">{error}</p> : null}
  </fieldset>;
}
