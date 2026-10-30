// "Open to 1-on-1 chats" (UI pass 1, 073 and 106; Alex, 30 Oct 2026, calls a and b): one
// switch on the account, with who can see you as its second line. The same control in
// Settings and in A9's "How do you want to meet?" sheet, which is a shortcut to it. What it
// opens is the database's rule (set_one_on_one, can_see_solo).
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors as palette, ONE_ON_ONE_COPY, spacing } from "@pind/shared";
import { SwitchRow } from "./SwitchRow";
import { Tap } from "./Tap";
import { failed } from "@/lib/errors";
import { myOneOnOne, setOneOnOne, type SoloChoice } from "@/lib/solo";

export function OneOnOneSwitch({ onChanged }: { onChanged?: (on: boolean) => void }) {
  const [state, setState] = useState<{ on: boolean; audience: SoloChoice } | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    myOneOnOne().then((s) => live && setState(s), () => live && setState({ on: false, audience: "everyone" }));
    return () => {
      live = false;
    };
  }, []);

  const save = async (on: boolean, audience: SoloChoice) => {
    setBusy(true);
    setSaid(null);
    try {
      await setOneOnOne(on, audience);
      setState({ on, audience });
      onChanged?.(on);
    } catch (err) {
      setSaid(failed("change that", err).says);
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      <SwitchRow
        icon="handshake"
        label={ONE_ON_ONE_COPY.switchLabel}
        line={ONE_ON_ONE_COPY.switchLine}
        value={state.on}
        disabled={busy}
        onChange={(on) => void save(on, state.audience)}
      />
      {state.on ? (
        <View style={styles.audience}>
          <Text style={styles.label}>{ONE_ON_ONE_COPY.audienceLabel}</Text>
          <View style={styles.chips}>
            {(
              [
                ["everyone", ONE_ON_ONE_COPY.everyone],
                ["women_only", ONE_ON_ONE_COPY.womenOnly],
              ] as const
            ).map(([value, name]) => {
              const on = state.audience === value;
              return (
                <Tap key={value} accessibilityRole="radio" accessibilityState={{ selected: on }} disabled={busy} onPress={() => void save(true, value)} style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipLabel, on && { color: palette.onAccent }]}>{name}</Text>
                </Tap>
              );
            })}
          </View>
        </View>
      ) : null}
      {said ? <Text accessibilityRole="alert" style={styles.refusal}>{said}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  audience: { gap: spacing.xs, paddingHorizontal: spacing.xs },
  label: { fontSize: 14, color: palette.textMuted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  chipLabel: { fontSize: 14, color: palette.text },
  refusal: { fontSize: 14, color: "#F3B4B4" },
});
