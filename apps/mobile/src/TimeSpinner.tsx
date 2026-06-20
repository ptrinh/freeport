/** Native time picker (@react-native-community/datetimepicker). */
import React from 'react';
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
  if (!visible) return null;
  return (
    <DateTimePicker
      value={value}
      mode="time"
      minuteInterval={15}
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      themeVariant="dark"
      onChange={(_e, d) => {
        if (Platform.OS !== 'ios') onClose();
        if (d) onPick(d);
      }}
    />
  );
}
