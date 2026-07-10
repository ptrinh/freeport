import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../../i18n';
import { type FareConfig } from '../../pricing';
import { currencySymbol, type Currency } from '../../locations';
import { NumberField } from '../../ui/fields';
import { s, palette } from '../../ui/theme';

function FareEstimator({
  fareConfig,
  fareDefaults,
  fareCurrency,
  onFareConfigChange,
}: {
  fareConfig: FareConfig | null;
  fareDefaults: FareConfig;
  fareCurrency: Currency;
  onFareConfigChange: (cfg: FareConfig | null) => void;
}) {
  const [fareOpen, setFareOpen] = useState(false);
  // Editor works off the active config; falls back to the built-in defaults
  // for the current currency/country until the user customizes.
  const fc = fareConfig ?? fareDefaults;
  const setFare = (patch: Partial<FareConfig>) =>
    onFareConfigChange({ ...fc, ...patch, vehicle: { ...fc.vehicle, ...(patch.vehicle ?? {}) } });
  const fareSym = currencySymbol(fareCurrency);

  return (
    <>
      {/* Fare Estimator — user-tunable coefficients for the ride-fare estimate */}
      <Pressable style={s.collapseHeader} onPress={() => setFareOpen((v) => !v)}>
        <View style={s.collapseLeft}>
          <Ionicons name="calculator-outline" size={20} color={palette.text2} style={s.collapseIcon} />
          <Text style={s.collapseTitle}>{t("Fare Estimator")}</Text>
        </View>
        <Text style={s.collapseChevron}>{fareOpen ? '▾' : '▸'}</Text>
      </Pressable>
      {fareOpen && (
        <>
          <Text style={s.dim}>{t("Adjust the coefficients used to estimate ride fares.")}</Text>
          <NumberField label={`${t("Base fare")} (${fareSym})`} value={fc.base} onCommit={(n) => setFare({ base: n })} />
          <NumberField label={`${t("Per kilometer")} (${fareSym})`} value={fc.perKm} onCommit={(n) => setFare({ perKm: n })} />
          <NumberField label={`${t("Road distance factor")} (×)`} value={fc.roadFactor} onCommit={(n) => setFare({ roadFactor: n })} />
          <Text style={[s.label, { marginTop: 6 }]}>{t("Vehicle multipliers")} (×)</Text>
          {(['Motorbike', 'Compact Car', 'Large Car', 'Luxury Car'] as const).map((v) => (
            <NumberField key={v} label={t(v)} value={fc.vehicle[v] ?? 1} onCommit={(n) => setFare({ vehicle: { [v]: n } })} />
          ))}
          <NumberField label={`${t("Peak-hour surge")} (+)`} value={fc.peakSurge} onCommit={(n) => setFare({ peakSurge: n })} />
          <NumberField label={`${t("Late-night factor")} (×)`} value={fc.nightFactor} onCommit={(n) => setFare({ nightFactor: n })} />
          {fareConfig && (
            <Pressable style={[s.btnDecline, { marginTop: 12 }]} onPress={() => onFareConfigChange(null)}>
              <Text style={s.btnText}>{t("Reset to defaults")}</Text>
            </Pressable>
          )}
        </>
      )}
    </>
  );
}

export { FareEstimator };
