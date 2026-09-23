// The small set of controls the onboarding screens are built from (A1–A3).
// Dark always (decisions Part 5), tokens from `@pind/shared`, never retyped.
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { colors as palette, radius, spacing } from "@pind/shared";
import { headlineFamily } from "@/lib/typeface";

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && { color: palette.textMuted }]}>{children}</Text>;
}

// The one thing on a screen that commits you. Purple is spent here and nowhere else
// on the screen (spec A7's rule, applied to a form).
export function Button({
  label,
  onPress,
  busy,
  disabled,
  kind = "primary",
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  kind?: "primary" | "quiet";
}) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        kind === "primary" ? styles.primary : styles.quiet,
        pressed && !off && { opacity: 0.85 },
        off && { opacity: 0.45 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={kind === "primary" ? palette.onAccent : palette.text} />
      ) : (
        <Text style={[styles.buttonLabel, kind === "quiet" && { color: palette.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  error,
  ...input
}: { label: string; hint?: string; error?: string } & TextInputProps) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={palette.tabInactive}
        {...input}
        style={[styles.input, !!error && { borderColor: "#E06B6B" }]}
      />
      {hint && !error ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

// A row of choices where exactly one is picked: gender, party size, a neighbourhood.
// Chips rather than a native picker, because a picker on the web is a different
// control on every browser and this one has four options.
export function Choice<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  options: readonly { value: T; name: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(o.value)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipLabel, on && { color: palette.onAccent }]}>{o.name}</Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Notice({ tone = "quiet", children }: { tone?: "quiet" | "stop"; children: ReactNode }) {
  return (
    <View style={[styles.notice, tone === "stop" && { borderColor: "#E06B6B" }]}>
      <Text style={[styles.body, tone === "stop" && { color: "#F3B4B4" }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontFamily: headlineFamily,
    fontSize: 27,
    lineHeight: 34,
    color: palette.text,
    letterSpacing: -0.4,
    marginBottom: spacing.sm,
  },
  body: { fontSize: 16, lineHeight: 23, color: palette.text },
  label: {
    fontFamily: headlineFamily,
    fontSize: 14,
    color: palette.textMuted,
    marginBottom: spacing.xs + 2,
  },
  hint: { fontSize: 13, lineHeight: 18, color: palette.textMuted, marginTop: spacing.xs + 2 },
  error: { fontSize: 13, lineHeight: 18, color: "#F3B4B4", marginTop: spacing.xs + 2 },
  input: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    color: palette.text,
    fontSize: 17,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  button: {
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  primary: { backgroundColor: palette.accent },
  quiet: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  buttonLabel: { fontFamily: headlineFamily, fontSize: 16, color: palette.onAccent },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  chipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  chipLabel: { fontSize: 15, color: palette.text },
  notice: {
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: spacing.md,
  },
});
