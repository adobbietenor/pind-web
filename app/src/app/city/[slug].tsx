// A6/A7 — a city's crowds this week (M3.3c; Alex, 6 Oct 2026). The app's version of W1:
// the same query (public_gatherings, for this city only — lib/crowds.ts), the same
// arithmetic (packages/shared/src/list.ts) and the same words on each card (crowdLine,
// entryLine, categoryLabel, clockLocal), drawn natively. A card opens the app's crowd
// page (A8), and everything follows from there. Dates, never size (Q10).
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import {
  categoryLabel,
  CHIP_ALL,
  CITIES,
  cityOpens,
  clockLocal,
  colors as palette,
  crowdLine,
  entryLine,
  fonts,
  HOME_COPY,
  ONE_LINER,
  radius,
  spacing,
  TABS,
  type TabValue,
} from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Trouble } from "@/components/Trouble";
import { Body, Heading } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { loadCityWeek, viewOf, type CityWeek, type ListGathering } from "@/lib/crowds";

export default function CityList() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const city = CITIES.find((c) => c.slug === slug);
  const [week, setWeek] = useState<CityWeek | null>(null);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [tab, setTab] = useState<TabValue>("events");
  const [chips, setChips] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!city || !cityOpens(city.slug)) return;
    let live = true;
    setTrouble(null);
    loadCityWeek(city.slug)
      .then((w) => live && setWeek(w))
      .catch((err) => live && setTrouble(failed("load this week's crowds", err)));
    return () => {
      live = false;
    };
  }, [city?.slug, attempt]);

  // A city that is not live has no list — a hand-typed link says so, and shows nothing.
  if (!city || !cityOpens(city.slug)) {
    return (
      <AppScreen>
        <Stack.Screen options={{ title: city?.name ?? "" }} />
        <Heading>{city?.name ?? "Not on Pin'd"}</Heading>
        <Body muted>{HOME_COPY.comingSoon}</Body>
      </AppScreen>
    );
  }

  if (trouble) {
    return (
      <AppScreen>
        <Stack.Screen options={{ title: city.name }} />
        <Heading>{city.name}</Heading>
        <Trouble what={trouble} onRetry={() => setAttempt((n) => n + 1)} />
      </AppScreen>
    );
  }

  if (!week) {
    return (
      <AppScreen scroll={false}>
        <Stack.Screen options={{ title: city.name }} />
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </AppScreen>
    );
  }

  const view = viewOf(week, tab, chips);
  const toggle = (value: string) => setChips((on) => (on.includes(value) ? on.filter((c) => c !== value) : [...on, value]));

  return (
    <AppScreen>
      <Stack.Screen options={{ title: city.name }} />
      {/* The header is hidden app-wide, so the city is said here (Alex, 6 Oct). */}
      <Text style={styles.city}>{city.name}</Text>
      <Heading>{tab === "community" ? "Community this week" : "This week's crowds"}</Heading>
      {/* W1's line under its heading, the same shared words (Alex, 6 Oct: smaller, italic). */}
      <Text style={styles.lede}>{ONE_LINER}</Text>

      {/* Two kinds of control, two shapes (Alex, 6 Oct): the MODE is a segmented control —
          one enclosed track, full width, the chosen segment filled; the FILTERS within it
          are loose pills. Told apart by shape and container, not colour. */}
      <View style={styles.track} accessibilityRole="tablist" testID="mode-track">
        {TABS.map((t) => {
          const on = t.value === tab;
          return (
            <Pressable
              key={t.value}
              accessibilityRole="tab"
              aria-selected={on}
              onPress={() => {
                setTab(t.value);
                setChips([]);
              }}
              style={[styles.segment, on && styles.segmentOn]}
            >
              <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {view.offered.length ? (
        <View style={styles.pills} testID="filters">
          {/* "Everything" first and on by default: the visible way back from a filter —
              W1's own first pill, the same word from the same constant. */}
          <Pressable accessibilityRole="checkbox" aria-checked={chips.length === 0} onPress={() => setChips([])} style={[styles.pill, chips.length === 0 && styles.pillOn]}>
            <Text style={[styles.pillText, chips.length === 0 && styles.pillTextOn]}>{CHIP_ALL}</Text>
          </Pressable>
          {view.offered.map((c) => {
            const on = chips.includes(c.value);
            return (
              <Pressable key={c.value} accessibilityRole="checkbox" aria-checked={on} onPress={() => toggle(c.value)} style={[styles.pill, on && styles.pillOn]}>
                <Text style={[styles.pillText, on && styles.pillTextOn]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {view.days.length === 0 ? (
        <View style={{ marginTop: spacing.lg }}>
          <Body muted>{HOME_COPY.listEmpty}</Body>
          {view.otherTabCount > 0 ? (
            <Body muted>{`${TABS.find((t) => t.value !== tab)!.label} has ${view.otherTabCount} this week.`}</Body>
          ) : null}
        </View>
      ) : (
        view.days.map((d) => (
          <View key={d.date} style={{ marginTop: spacing.lg }}>
            <Text style={styles.day}>
              {d.label}
              {d.sub ? <Text style={styles.daySub}>{`  ${d.sub}`}</Text> : null}
            </Text>
            {d.rows.map((g) => (
              <Card key={g.slug} g={g} onPress={() => router.push({ pathname: "/crowd/[slug]", params: { slug: g.slug } })} />
            ))}
          </View>
        ))
      )}
    </AppScreen>
  );
}

function Card({ g, onPress }: { g: ListGathering; onPress: () => void }) {
  // W1's card rules: a category when someone said what it is; a price unless it is a
  // plain ticketed listing (which would be a tag on every row and say nothing).
  const free = g.entry === "ticketed" && !g.entry_note ? null : entryLine(g);
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <Text style={styles.when}>{clockLocal(g.starts_at, g.city_timezone)}</Text>
      <Text style={styles.name}>{g.name}</Text>
      <View style={styles.tags}>
        {g.category ? <Text style={styles.tag}>{categoryLabel(g.category)}</Text> : null}
        {free ? <Text style={styles.tag}>{free}</Text> : null}
      </View>
      <Text style={styles.where}>{g.venue_name}</Text>
      {g.blurb ? <Text style={styles.what}>{g.blurb}</Text> : null}
      <Text style={styles.tally}>{crowdLine(g)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lede: { fontSize: 14, fontStyle: "italic", color: palette.textMuted, marginTop: 2 },
  city: { fontSize: 13, color: palette.accentText, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 2 },
  // The mode: one enclosed track, full width, squared-off segments inside it.
  track: { flexDirection: "row", alignSelf: "stretch", marginTop: spacing.md, padding: 3, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  segment: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.sm },
  segmentOn: { backgroundColor: palette.accent },
  segmentText: { color: palette.textMuted, fontSize: 15, fontFamily: fonts.headline },
  segmentTextOn: { color: palette.onAccent },
  // The filters: loose, fully rounded pills, each its own outline, no shared container.
  pills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md },
  pill: { paddingVertical: 5, paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, borderColor: palette.border },
  pillOn: { borderColor: palette.accent, backgroundColor: palette.accent },
  pillText: { color: palette.textMuted, fontSize: 13 },
  pillTextOn: { color: palette.onAccent },
  day: { fontFamily: fonts.headline, fontSize: 17, color: palette.text, marginBottom: spacing.xs },
  daySub: { fontFamily: undefined, fontSize: 13, color: palette.textMuted },
  card: { padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, marginTop: spacing.sm, gap: 2 },
  when: { fontSize: 13, color: palette.accentText },
  name: { fontFamily: fonts.headline, fontSize: 16, color: palette.text },
  tags: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  tag: { fontSize: 12, color: palette.textMuted, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm ?? 4, paddingHorizontal: 6 },
  where: { fontSize: 14, color: palette.textMuted },
  what: { fontSize: 14, color: palette.text },
  tally: { fontSize: 13, color: palette.textMuted, marginTop: 4 },
});
