'use client';

import { shiftCalendarDate, venezuelaToday } from '@playsport/shared';

export default function CalendarDateShortcuts({ date, onChange }: {
  date: string | null;
  onChange: (_date: string) => void; // eslint-disable-line no-unused-vars
}) {
  const today = venezuelaToday();
  return <div className="calendarDateShortcuts" role="group" aria-label="Fechas rápidas">
    {([{ label: 'Ayer', offset: -1 }, { label: 'Hoy', offset: 0 }, { label: 'Mañana', offset: 1 }] as const).map(({ label, offset }) =>
      <button key={label} type="button" className="managerButtonOutline"
        aria-pressed={date === shiftCalendarDate(today, offset)}
        onClick={() => onChange(shiftCalendarDate(venezuelaToday(), offset))}>{label}</button>)}
  </div>;
}
