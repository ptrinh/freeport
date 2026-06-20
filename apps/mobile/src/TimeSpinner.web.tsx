/** Web time picker — native HTML <input type="time"> (15-min steps). */
import React from 'react';

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
  const hh = String(value.getHours()).padStart(2, '0');
  const mm = String(value.getMinutes()).padStart(2, '0');
  return React.createElement('input', {
    type: 'time',
    step: 900,
    value: `${hh}:${mm}`,
    onChange: (e: any) => {
      const [h, m] = String(e.target.value).split(':').map(Number);
      const d = new Date(value);
      d.setHours(h || 0, m || 0, 0, 0);
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
