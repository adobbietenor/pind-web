// A6/A7 — a city's crowds this week (M3.3c; Alex, 6 Oct 2026). The app's version of W1:
// the same query (public_gatherings, for this city only — lib/crowds.ts), the same
// arithmetic (packages/shared/src/list.ts) and the same words on each card (crowdLine,
// entryLine, categoryLabel, clockLocal), drawn natively. A card opens the app's crowd
// page (A8), and everything follows from there. Dates, never size (Q10).
//
// M3.2b (Alex, 10 Oct 2026):
//   * **Search** — the same door with a query, over everything published ahead; while a
//     search is on, its results replace the week. The empty result says what Pin'd is (a
//     selection) and offers this week and "Suggest it" — never a dead end.
//   * **Interests, remembered** — the chips a person chose, kept on their account
//     (lib/interests.ts). Only a chip on the row this week is applied, so a remembered
//     interest can never empty the page; one with no chip is named as resting. Visibly
//     on, with "Show everything" in the same line. Narrowing, never reordering (Q10).
//     The rules are packages/shared/src/search.ts (Y02–Y05).
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  categoryLabel,
  CHIP_ALL,
  chipsFor,
  CITIES,
  cityOpens,
  clockLocal,
  colors as palette,
  crowdLine,
  entryLine,
  fonts,
  HOME_COPY,
  INTERESTS_COPY,
  INTERESTS_NOT_SAVED,
  interestsHere,
  ONE_LINER,
  radius,
  rememberAfter,
  SEARCH_COPY,
  SEARCH_MAX,
  searchQuery,
  spacing,
  SUGGEST_TO,
  suggestSubject,
  TABS,
  type DayGroup,
  type TabValue,
} from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Trouble } from "@/components/Trouble";
import { Body, Heading, Notice } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { loadCityWeek, searchCity, viewOf, type CityWeek, type ListGathering } from "@/lib/crowds";
import { readInterests, saveInterests } from "@/lib/interests";
import { report } from "@/lib/sentry";

type Found = { q: string; count: number; days: DayGroup<ListGathering>[] };

export default function CityList() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const city = CITIES.find((c) => c.slug === slug);
  const [week, setWeek] = useState<CityWeek | null>(null);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [tab, setTab] = useState<TabValue>("events");
  const [chips, setChips] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  // undefined while reading; null when there is nobody to remember for.
  const [remembered, setRemembered] = useState<string[] | null | undefined>(undefined);
  const [seeded, setSeeded] = useState(false);
  const [notSaved, setNotSaved] = useState(false);
  const [typed, setTyped] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [searching, setSearching] = useState<string | null>(null);
  const [searchTrouble, setSearchTrouble] = useState<Described | null>(null);

  useEffect(() => {
    if (!city || !cityOpens(city.slug)) return;
    let live = true;
    setTrouble(null);
    loadCityWeek(city.slug)
      .then((w) => live && setWeek(w))
      .catch((err) => live && setTrouble(failed("load this week's crowds", err)));
    // Interests are a convenience: if they cannot be read, the list works as it always
    // has and nothing says "your interests".
    readInterests()
      .then((r) => live && setRemembered(r))
      .catch((err) => {
        report(err, "read interests");
        if (live) setRemembered(null);
      });
    return () => {
      live = false;
    };
  }, [city?.slug, attempt]);

  // The remembered chips go on once, when both the week and the interests are in.
  useEffect(() => {
    if (seeded || !week || remembered === undefined) return;
    setChips(interestsHere(remembered ?? [], chipsFor(week.thisWeek, tab), tab).on);
    setSeeded(true);
  }, [week, remembered, seeded, tab]);

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

  if (!week || !seeded) {
    return (
      <AppScreen scroll={false}>
        <Stack.Screen options={{ title: city.name }} />
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </AppScreen>
    );
  }

  const view = viewOf(week, tab, chips);
  const here = interestsHere(remembered ?? [], view.offered, tab);

  // Every tap on a chip is also what is remembered (for someone with an account): the
  // chips on here, plus every remembered interest this tab did not offer.
  const choose = (next: string[]) => {
    setChips(next);
    if (remembered === null || remembered === undefined) return;
    const keep = next.length === 0 ? [] : rememberAfter(remembered, view.offered, next);
    setRemembered(keep);
    setNotSaved(false);
    saveInterests(keep).catch((err) => {
      report(err, "save interests");
      setNotSaved(true);
    });
  };
  const toggle = (value: string) => choose(chips.includes(value) ? chips.filter((c) => c !== value) : [...chips, value]);

  const runSearch = (raw: string) => {
    const q = searchQuery(raw);
    setSearchTrouble(null);
    if (!q) {
      setFound(null);
      return;
    }
    setSearching(q);
    searchCity(city.slug, q)
      .then((r) => setFound({ q, ...r }))
      .catch((err) => setSearchTrouble(failed("search", err)))
      .finally(() => setSearching(null));
  };
  const clearSearch = () => {
    setTyped("");
    setFound(null);
    setSearchTrouble(null);
  };

  return (
    <AppScreen>
      <Stack.Screen options={{ title: city.name }} />
      {/* The header is hidden app-wide, so the city is said here (Alex, 6 Oct). */}
      <Text style={styles.city}>{city.name}</Text>
      <Heading>{found ? SEARCH_COPY.label : tab === "community" ? "Community this week" : "This week's crowds"}</Heading>
      {/* W1's line under its heading, the same shared words (Alex, 6 Oct: smaller, italic). */}
      <Text style={styles.lede}>{ONE_LINER}</Text>

      <View style={styles.search}>
        <TextInput
          value={typed}
          onChangeText={setTyped}
          onSubmitEditing={() => runSearch(typed)}
          placeholder={SEARCH_COPY.placeholder}
          placeholderTextColor={palette.textMuted}
          accessibilityLabel={SEARCH_COPY.label}
          returnKeyType="search"
          maxLength={SEARCH_MAX}
          autoCorrect={false}
          style={styles.searchInput}
        />
        <Pressable accessibilityRole="button" onPress={() => runSearch(typed)} style={styles.searchButton}>
          {searching ? <ActivityIndicator color={palette.onAccent} /> : <Text style={styles.searchButtonText}>{SEARCH_COPY.label}</Text>}
        </Pressable>
      </View>
      {searchTrouble ? <Trouble what={searchTrouble} onRetry={() => runSearch(typed)} /> : null}

      {found ? (
        <SearchResults
          found={found}
          cityName={city.name}
          onClear={clearSearch}
          onOpen={(s) => router.push({ pathname: "/crowd/[slug]", params: { slug: s } })}
        />
      ) : (
        <>
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
                    // The other tab's remembered interests go on there, as they do here.
                    setChips(interestsHere(remembered ?? [], chipsFor(week.thisWeek, t.value), t.value).on);
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
              {/* "Everything" first: the visible way back from a filter — W1's own first
                  pill, the same word from the same constant. For someone with remembered
                  interests it is also the one-tap clear. */}
              <Pressable accessibilityRole="checkbox" aria-checked={chips.length === 0} onPress={() => choose([])} style={[styles.pill, chips.length === 0 && styles.pillOn]}>
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

          {/* Interests are visibly on, with the way off in the same line; one resting is
              named, never applied. Only for someone whose interests are kept. */}
          {remembered && chips.length > 0 ? (
            <Text style={styles.interests}>
              {INTERESTS_COPY.on}
              {"  ·  "}
              <Text accessibilityRole="button" onPress={() => choose([])} style={styles.interestsLink}>
                {INTERESTS_COPY.showEverything}
              </Text>
            </Text>
          ) : null}
          {remembered && here.resting.length > 0 ? (
            <Text style={styles.interestsMuted}>{INTERESTS_COPY.resting(here.resting.map(categoryLabel))}</Text>
          ) : null}
          {notSaved ? <Text style={styles.interestsMuted}>{INTERESTS_NOT_SAVED}</Text> : null}

          {view.days.length === 0 ? (
            <View style={{ marginTop: spacing.lg }}>
              <Body muted>{HOME_COPY.listEmpty}</Body>
              {view.otherTabCount > 0 ? (
                <Body muted>{`${TABS.find((t) => t.value !== tab)!.label} has ${view.otherTabCount} this week.`}</Body>
              ) : null}
            </View>
          ) : (
            <Days days={view.days} onOpen={(s) => router.push({ pathname: "/crowd/[slug]", params: { slug: s } })} />
          )}
        </>
      )}
    </AppScreen>
  );
}

function SearchResults({ found, cityName, onClear, onOpen }: { found: Found; cityName: string; onClear: () => void; onOpen: (slug: string) => void }) {
  if (found.count === 0) {
    return (
      <View style={{ marginTop: spacing.lg }}>
        <Notice>{SEARCH_COPY.none(found.q, cityName)}</Notice>
        <View style={styles.ways}>
          <Text accessibilityRole="link" onPress={onClear} style={styles.interestsLink}>
            {SEARCH_COPY.thisWeek}
          </Text>
          <Text
            accessibilityRole="link"
            onPress={() => void Linking.openURL(`mailto:${SUGGEST_TO}?subject=${encodeURIComponent(suggestSubject(found.q))}`)}
            style={styles.interestsLink}
          >
            {SEARCH_COPY.suggest}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <>
      <Text style={styles.interests}>
        {SEARCH_COPY.found(found.count, found.q)}
        {"  ·  "}
        <Text accessibilityRole="button" onPress={onClear} style={styles.interestsLink}>
          {SEARCH_COPY.clear}
        </Text>
      </Text>
      <Days days={found.days} onOpen={onOpen} />
    </>
  );
}

function Days({ days, onOpen }: { days: DayGroup<ListGathering>[]; onOpen: (slug: string) => void }) {
  return (
    <>
      {days.map((d) => (
        <View key={d.date} style={{ marginTop: spacing.lg }}>
          <Text style={styles.day}>
            {d.label}
            {d.sub ? <Text style={styles.daySub}>{`  ${d.sub}`}</Text> : null}
          </Text>
          {d.rows.map((g) => (
            <Card key={g.slug} g={g} onPress={() => onOpen(g.slug)} />
          ))}
        </View>
      ))}
    </>
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
  // Search: the field and its button on one line, W1's shape.
  search: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.md },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 10, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, color: palette.text, fontSize: 16 },
  searchButton: { justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: palette.accent, minWidth: 76, alignItems: "center" },
  searchButtonText: { color: palette.onAccent, fontFamily: fonts.headline, fontSize: 15 },
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
  interests: { fontSize: 13, color: palette.text, marginTop: spacing.sm },
  interestsMuted: { fontSize: 13, color: palette.textMuted, marginTop: 4 },
  interestsLink: { color: palette.accentText, textDecorationLine: "underline" },
  ways: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.sm },
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
