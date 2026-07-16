/** Web date+time picker — native HTML <input type="datetime-local"> (15-min steps). */
import React from 'react';

const pad = (n: number) => String(n).padStart(2, '0');

export function TimeSpinner({
  value,
  visible,
  onPick,
}: {
  value: Date;
  visible: boolean;
  onPick: (d: Date) => void;
  onClose: () => void;
}) {
  if (!visible) return null;
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const local = fmt(value);
  // Allow booking up to 7 days ahead.
  const max = fmt(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  return React.createElement('input', {
    type: 'datetime-local',
    step: 900,
    value: local,
    max,
    onChange: (e: { target: { value: string } }) => {
      const v = String(e.target.value);
      if (!v) return;
      const [datePart, timePart] = v.split('T');
      const [y, mo, da] = datePart.split('-').map(Number);
      const [h, mi] = (timePart || '0:0').split(':').map(Number);
      const d = new Date(value);
      d.setFullYear(y, (mo || 1) - 1, da || 1);
      d.setHours(h || 0, mi || 0, 0, 0);
      onPick(d);
    },
    style: {
      background: '#111827',
      color: '#e8edf2',
      border: '1px solid #1e2a3a',
      borderRadius: 8,
      padding: 10,
      fontSize: 16,
      marginTop: 6,
      colorScheme: 'dark',
    },
  });
}
