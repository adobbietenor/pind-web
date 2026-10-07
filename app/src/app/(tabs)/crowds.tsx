// A5 — Home: pick a city (M3.3c; Alex, 6 Oct 2026). Replaces M2.0's empty scaffold.
//
// Four cities from packages/shared's CITIES — the one list a city going live changes.
// Toronto opens its list (/city/toronto, A6/A7); the others say "Coming soon" and do not
// respond to a tap. **Pin'd never asks where you are** (H4): a picker is how you get to a
// city, not your phone's location.
//
// Below it, setting up a profile now — optional. Skipped, nothing changes: the pin-time
// prompt (A27) still asks for what it needs, exactly as before. Offered only to someone
// without a permanent account, and it goes to the same sign-in Profile's own "Set up
// your profile" uses.
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CITIES, cityOpens, colors as palette, fonts, HOME_COPY, radius, spacing } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Body, Button, Heading } from "@/components/ui";
import { readProfile } from "@/lib/profile";

export default function Home() {
  const router = useRouter();
  const [offerProfile, setOfferProfile] = useState(false);

  // Re-read on every visit: someone who set up their profile and came back should not
  // be offered it again.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      readProfile()
        .then((p) => live && setOfferProfile(!p.permanent))
        // No session yet is someone who has not started: offer it. A failure to read is
        // not a reason to hide an optional button — tapping it goes to sign-in either way.
        .catch(() => live && setOfferProfile(true));
      return () => {
        live = false;
      };
    }, []),
  );

  return (
    <AppScreen edges={["top"]}>
      <Heading>{HOME_COPY.heading}</Heading>
      <Body muted>{HOME_COPY.line}</Body>

      <View style={styles.cities}>
        {CITIES.map((c) => {
          const opens = cityOpens(c.slug);
          return (
            <Pressable
              key={c.slug}
              accessibilityRole="button"
              accessibilityState={{ disabled: !opens }}
              accessibilityLabel={opens ? c.name : `${c.name}, ${HOME_COPY.comingSoon}`}
              disabled={!opens}
              onPress={() => router.push({ pathname: "/city/[slug]", params: { slug: c.slug } })}
              style={({ pressed }) => [styles.city, !opens && styles.cityOff, pressed && opens && styles.cityPressed]}
            >
              <Text style={[styles.cityName, !opens && styles.cityNameOff]}>{c.name}</Text>
              {opens ? <Text style={styles.chevron}>›</Text> : <Text style={styles.soon}>{HOME_COPY.comingSoon}</Text>}
            </Pressable>
          );
        })}
      </View>

      {offerProfile ? (
        <View style={styles.profile}>
          <Body>{HOME_COPY.profileHeading}</Body>
          <Body muted>{HOME_COPY.profileLine}</Body>
          <View style={{ marginTop: spacing.sm }}>
            <Button kind="quiet" label={HOME_COPY.profileButton} onPress={() => router.push("/sign-in")} />
          </View>
        </View>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  cities: { marginTop: spacing.lg, gap: spacing.sm },
  city: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: palette.accent,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
  cityPressed: { opacity: 0.8 },
  cityOff: { borderColor: palette.border, backgroundColor: palette.background },
  cityName: { fontFamily: fonts.headline, fontSize: 18, color: palette.text },
  cityNameOff: { color: palette.textMuted },
  chevron: { fontSize: 22, color: palette.text },
  soon: { fontSize: 13, color: palette.textMuted },
  profile: {
    marginTop: spacing.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
});
