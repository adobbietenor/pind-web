// A26 — Quick pin, in the app (M3.2). Also where "change or remove my pin" lands.
//
// **The one screen built twice** (Alex, M3.2; spec §4): the Worker renders A26 for a
// stranger on the web, and this renders it for someone who has the app — or who is
// already signed in on the web, whom the Worker's page sends here so they pin as
// themselves. Its fields, words, validation and the write itself are not in this file:
// they are `@pind/shared/quickpin.ts`, and tests/unit/quickpin.test.ts (Q04) fails if
// this screen writes its own.
//
// Lives at /pin/<slug>, not /g/<slug>/pin, because on the web the Worker owns that
// path. `g/[slug]/pin.tsx` sends a universal link that lands there on to here.
//
// After the effective end a pin can be removed but not changed (decisions, M3.2).
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, View } from "react-native";
import {
  colors as palette,
  PARTY_CHOICES,
  QUICKPIN_COPY,
  QUICKPIN_FIELDS,
  countLine,
  effectiveEnd,
  pinnedMarker,
  readQuickPin,
  SEE_WHOS_GOING,
  spacing,
  THRESHOLD,
  writeQuickPin,
  type QuickPinDb,
  type QuickPinInput,
} from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Choice, Field, Heading, Tick } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { myAuthId, whoAmI } from "@/lib/session";
import { ensureAnonymousUser, supabase } from "@/lib/supabase";

// The crowd page is the Worker’s (W2), on the web and from the app alike.
const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://pind.social";

type Party = (typeof PARTY_CHOICES)[number]["value"];
const PARTY_OPTIONS = PARTY_CHOICES.map((c) => ({ value: c.value, name: c.label }));

interface Gathering {
  id: string;
  slug: string;
  name: string;
  effective_end: string;
  venue: string;
}

type Stage = "loading" | "form" | "done" | "removed";

// W2 reads this marker to say "See who's going" instead of "Pin in" (pinnedMarker). On
// the web this screen shares W2's origin, so it keeps the marker true both ways.
function markPinned(slug: string, pinned: boolean) {
  if (Platform.OS !== "web") return;
  try {
    if (pinned) localStorage.setItem(pinnedMarker(slug), "1");
    else localStorage.removeItem(pinnedMarker(slug));
  } catch {
    // Storage off: W2 keeps saying "Pin in", which still leads here.
  }
}

export default function QuickPin() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [stage, setStage] = useState<Stage>("loading");
  const [gathering, setGathering] = useState<Gathering | null>(null);
  const [pinId, setPinId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [party, setParty] = useState<Party>("1");
  const [groupSize, setGroupSize] = useState("");
  const [meetUp, setMeetUp] = useState(false);
  const [nineteen, setNineteen] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: string; says: string } | null>(null);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ already: boolean; needsOptIn: boolean; pinned?: number; open?: number } | null>(null);

  const load = useCallback(async () => {
    setTrouble(null);
    const db = supabase();
    // Through RLS, not the public door: a tester reaches the seed gathering here, and
    // nobody else does (the door never shows a seed row to anyone).
    const { data: row, error } = await db
      .from("gatherings")
      .select("id, slug, name, starts_at, ends_at, venues(name)")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    if (!row) {
      setTrouble({ says: "That crowd is not on Pin'd." });
      setStage("form");
      return;
    }
    const g: Gathering = {
      id: row.id,
      slug: row.slug ?? slug,
      name: row.name,
      effective_end: effectiveEnd(row.starts_at, row.ends_at),
      venue: (row as unknown as { venues: { name: string } | null }).venues?.name ?? "",
    };
    setGathering(g);

    // Already pinned here? Then this is the edit screen, filled in.
    const who = await whoAmI();
    if (who.state === "in") {
      const { data: me } = await db.from("people").select("id, first_name").eq("auth_user_id", who.userId).maybeSingle();
      if (me) {
        setFirstName(me.first_name);
        const { data: pin } = await db
          .from("pins")
          .select("id, party_total, open_to_meeting")
          .eq("person_id", me.id)
          .eq("gathering_id", g.id)
          .maybeSingle();
        if (pin) {
          setPinId(pin.id);
          setMeetUp(pin.open_to_meeting);
          if (pin.party_total <= 3) setParty(String(pin.party_total) as Party);
          else {
            setParty("group");
            setGroupSize(String(pin.party_total));
          }
          // The 19+ record exists for anyone already pinned (P100).
          setNineteen(true);
        }
      }
    }
    setStage("form");
  }, [slug]);

  useEffect(() => {
    load().catch((err) => {
      setTrouble(failed("open this crowd", err));
      setStage("form");
    });
  }, [load]);

  const closed = !!gathering && Date.now() >= Date.parse(gathering.effective_end);

  const counts = async (gatheringId: string) => {
    const { data } = await supabase().rpc("gathering_counts", { gathering_ids: [gatheringId] });
    const row = (data as { pinned: number; open_to_meeting: number }[] | null)?.[0];
    return row ? { pinned: row.pinned, open: row.open_to_meeting } : {};
  };

  const submit = async () => {
    if (!gathering) return;
    setFieldError(null);
    setTrouble(null);
    const input: QuickPinInput = {
      [QUICKPIN_FIELDS.firstName]: firstName,
      [QUICKPIN_FIELDS.party]: party,
      [QUICKPIN_FIELDS.groupSize]: groupSize,
      [QUICKPIN_FIELDS.meetUp]: meetUp ? "on" : undefined,
      [QUICKPIN_FIELDS.nineteen]: nineteen ? "on" : undefined,
    };
    const read = readQuickPin(input);
    if (!read.ok) {
      setFieldError({ field: read.field, says: read.says });
      return;
    }
    setBusy(true);
    try {
      // Signed in already (the app, or the web after a claim): pin as that person.
      // Otherwise this is someone new in the app: the anonymous user is made here,
      // at pin-in, never on launch.
      const who = await whoAmI();
      const userId = who.state === "in" ? who.userId : who.state === "out" ? await ensureAnonymousUser() : await myAuthId();
      const written = await writeQuickPin(supabase() as unknown as QuickPinDb, userId, gathering.id, read.value);
      markPinned(gathering.slug, true);
      setResult({ already: written.already, needsOptIn: written.needsOptIn, ...(await counts(gathering.id)) });
      setStage("done");
    } catch (err) {
      setTrouble(failed("pin you in", err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pinId) return;
    setBusy(true);
    setTrouble(null);
    try {
      const { error } = await supabase().from("pins").delete().eq("id", pinId);
      if (error) throw error;
      setPinId(null);
      if (gathering) markPinned(gathering.slug, false);
      setStage("removed");
    } catch (err) {
      setTrouble(failed("remove your pin", err));
    } finally {
      setBusy(false);
    }
  };

  if (stage === "loading") {
    return (
      <AppScreen scroll={false}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </AppScreen>
    );
  }

  const where = gathering ? `${gathering.name} · ${gathering.venue}` : "";

  if (stage === "removed") {
    return (
      <AppScreen>
        <Heading>{QUICKPIN_COPY.heading}</Heading>
        <Body muted>{where}</Body>
        <View style={{ marginTop: spacing.lg }}>
          <Body>{QUICKPIN_COPY.removed}</Body>
        </View>
        {gathering ? (
          <View style={{ marginTop: spacing.lg }}>
            <Button kind="quiet" label={QUICKPIN_COPY.backToCrowd} onPress={() => router.replace(`/crowd/${gathering.slug}`)} />
          </View>
        ) : null}
      </AppScreen>
    );
  }

  if (stage === "done" && result && gathering) {
    return (
      <AppScreen>
        <Heading>{result.already ? QUICKPIN_COPY.alreadyPinned : QUICKPIN_COPY.pinned}</Heading>
        <Body muted>{where}</Body>
        {result.needsOptIn ? (
          <View style={{ marginTop: spacing.md }}>
            <Body>{QUICKPIN_COPY.optInNext}</Body>
          </View>
        ) : null}
        {/* The one primary button (spec A26, M3.2), the same branch as the Worker's
            confirmation: ticked "meet up" → A27; otherwise → A9. */}
        <View style={{ marginTop: spacing.lg }}>
          {result.needsOptIn ? (
            <Button label={QUICKPIN_COPY.nextDetails} onPress={() => router.push(`/opt-in/${gathering.slug}`)} />
          ) : (
            <Button label={SEE_WHOS_GOING} onPress={() => router.push(`/crowd/${gathering.slug}`)} />
          )}
        </View>
        {result.pinned !== undefined ? (
          <View style={{ marginTop: spacing.lg, gap: spacing.xs }}>
            <Heading>{countLine(result.pinned, result.open ?? 0, THRESHOLD).line}</Heading>
            {countLine(result.pinned, result.open ?? 0, THRESHOLD).crews ? (
              <Body muted>{countLine(result.pinned, result.open ?? 0, THRESHOLD).crews}</Body>
            ) : null}
          </View>
        ) : null}
        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          <Button kind="quiet" label={QUICKPIN_COPY.editOrRemove} onPress={() => void load().catch(() => undefined)} />
          <Button kind="quiet" label={QUICKPIN_COPY.share} onPress={() => void Linking.openURL(`${SITE}/g/${gathering.slug}`)} />
          <Button kind="quiet" label={QUICKPIN_COPY.addToCalendar} onPress={() => void Linking.openURL(`${SITE}/g/${gathering.slug}.ics`)} />
        </View>
      </AppScreen>
    );
  }

  const errorFor = (field: string) => (fieldError?.field === field ? fieldError.says : undefined);

  return (
    <AppScreen>
      <Heading>{QUICKPIN_COPY.heading}</Heading>
      <View style={{ marginBottom: spacing.lg }}>
        <Body muted>{where}</Body>
      </View>

      {closed && pinId ? (
        <>
          <Body>{QUICKPIN_COPY.closedCanRemove}</Body>
          <View style={{ marginTop: spacing.lg }}>
            {trouble ? <Trouble what={trouble} onRetry={remove} busy={busy} /> : null}
            <Button kind="quiet" label={QUICKPIN_COPY.remove} busy={busy} onPress={remove} />
          </View>
        </>
      ) : closed ? (
        <Body>{QUICKPIN_COPY.closed}</Body>
      ) : (
        <>
          <Field
            label={QUICKPIN_COPY.firstName}
            hint={QUICKPIN_COPY.firstNameHint}
            error={errorFor(QUICKPIN_FIELDS.firstName)}
            value={firstName}
            onChangeText={setFirstName}
            autoComplete="given-name"
            autoCapitalize="words"
            maxLength={40}
          />
          <Choice label={QUICKPIN_COPY.party} options={PARTY_OPTIONS} value={party} onChange={setParty} />
          {party === "group" ? (
            <Field
              label={QUICKPIN_COPY.groupSize}
              error={errorFor(QUICKPIN_FIELDS.groupSize)}
              value={groupSize}
              onChangeText={setGroupSize}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={2}
            />
          ) : null}
          {errorFor(QUICKPIN_FIELDS.party) ? <Body muted>{errorFor(QUICKPIN_FIELDS.party)}</Body> : null}
          <Tick label={QUICKPIN_COPY.meetUp} hint={QUICKPIN_COPY.meetUpHint} value={meetUp} onChange={setMeetUp} />
          <Tick
            label={QUICKPIN_COPY.nineteen}
            value={nineteen}
            onChange={setNineteen}
            error={errorFor(QUICKPIN_FIELDS.nineteen)}
          />
          {/* Beside the button that was tapped (CLAUDE.md: "seen" is part of a refusal). */}
          {trouble ? <Trouble what={trouble} onRetry={submit} busy={busy} /> : null}
          <Button label={pinId ? QUICKPIN_COPY.save : QUICKPIN_COPY.submit} busy={busy} onPress={submit} />
          {pinId ? (
            <View style={{ marginTop: spacing.sm }}>
              <Button kind="quiet" label={QUICKPIN_COPY.remove} busy={busy} onPress={remove} />
            </View>
          ) : null}
        </>
      )}
    </AppScreen>
  );
}
