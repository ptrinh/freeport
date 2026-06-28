/** Native date+time picker (@react-native-community/datetimepicker). */
import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

export function TimeSpinner({
  value,
  visible,
  onPick,
  onClose,
}: {
  value: Date;
  visible: boolean;
  onPick: (d: Date) => void;
  onClose: () => void;
}) {
  // Android has no combined date+time spinner, so step through date → time.
  const [androidStep, setAndroidStep] = useState<'date' | 'time'>('date');
  const [draft, setDraft] = useState<Date>(value);
  useEffect(() => { if (visible) { setAndroidStep('date'); setDraft(value); } }, [visible]);

  if (!visible) return null;

  // Allow booking up to 7 days ahead (was effectively much shorter before).
  const maxDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  if (Platform.OS === 'ios') {
    // One spinner with a date column plus hour/minute/AM-PM.
    return (
      <DateTimePicker
        value={value}
        mode="datetime"
        minuteInterval={15}
        display="spinner"
        themeVariant="dark"
        maximumDate={maxDate}
        onChange={(_e, d) => { if (d) onPick(d); }}
      />
    );
  }

  // Android: pick the date first, then the time, and merge them.
  if (androidStep === 'date') {
    return (
      <DateTimePicker
        value={draft}
        mode="date"
        display="default"
        maximumDate={maxDate}
        onChange={(e, d) => {
          if (e.type === 'dismissed' || !d) { onClose(); return; }
          const merged = new Date(d);
          merged.setHours(draft.getHours(), draft.getMinutes(), 0, 0);
          setDraft(merged);
          setAndroidStep('time');
        }}
      />
    );
  }
  return (
    <DateTimePicker
      value={draft}
      mode="time"
      minuteInterval={15}
      display="default"
      onChange={(e, d) => {
        onClose();
        if (e.type === 'dismissed' || !d) return;
        const merged = new Date(draft);
        merged.setHours(d.getHours(), d.getMinutes(), 0, 0);
        onPick(merged);
      }}
    />
  );
}
