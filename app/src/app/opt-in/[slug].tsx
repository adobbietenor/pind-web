// A27 — Opt in (M3.2): what makes "I'd like to meet up" real, on the link path.
//
// **One set of profile steps, in this path's order** (Alex, M3.2 walk: A2 and A27 were
// two implementations of the same screen, and the women-only question had drifted).
// The steps are the shared components the store path draws too (components/profile);
// this screen only puts them in order and runs what is A27's alone:
//
//   1. "you" — date of birth first, so **under 19 stops before anything else is
//      collected** (H8) and removes them completely: the pin, the person, the 19+
//      record and the anonymous user (`remove_me_under_19`, P103); then gender and a
//      photo, required here (Q2, the gate);
//   2. "where" — neighbourhood and tags, **Skip kept** (Alex: "a thinner profile is
//      better than no profile"); what is skipped is named on Profile afterwards;
//   3. "identity" — Apple, Google or the email code on the SAME user, so the pin and
//      party survive (P84); an identity that already has an account is the merge;
//   4. the safety sheet, where the privacy policy and terms are accepted — and only
//      then is the pin opened. The database refuses it any earlier.
//
// **Every step is chosen from a fresh read** (CLAUDE.md: re-read who you are after
// anything that can change it): after each step, after a merge, after a return from
// Apple or Google. `nextOptInStep` (shared) decides, from the gate's own facts.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, StyleSheet, View } from "react-native";
import {
  colors as palette,
  nextOptInStep,
  OPTIN_COPY,
  optInMissing,
  POLICY_VERSION,
  radius,
  spacing,
  whereComplete,
  type OptInStep,
} from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { IdentityStep } from "@/components/profile/IdentityStep";
import { WhereStep } from "@/components/profile/WhereStep";
import { YouStep } from "@/components/profile/YouStep";
import type { Picked } from "@/components/TagPicker";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading, Tick } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { finishWebReturn, type Provider } from "@/lib/merge";
import { readProfile } from "@/lib/profile";
import { report } from "@/lib/sentry";
import { supabase } from "@/lib/supabase";
import { loadTags } from "@/lib/tags";

const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://pind.social";

type Step = "loading" | OptInStep | "removed" | "lost";

// Why there is nothing here to fill in — never a blank page (M3.2 walk: after a merge
// into an account that is not a tester, the test crowd vanished and A27 showed only its
// heading, on every refresh). Each says what happened and offers the way on.
type Lost = "crowd" | "person" | "failed";
const LOST_SAYS: Record<Lost, string> = {
  crowd: "This crowd isn't open to the account you're signed in as.",
  person: "Pin in first — this page follows the pin.",
  failed: "We couldn't open this step. Check your connection and try again.",
};

interface Mine {
  personId: string;
  firstName: string;
  gatheringId: string;
  gatheringName: string;
  permanent: boolean;
  hasPrivate: boolean;
  hasPhoto: boolean;
  neighbourhood: string | null;
  tags: Picked[];
}

// Where this person stands, read fresh as whoever is signed in NOW: the gathering, and
// their profile — or why there is nothing to follow.
async function readMine(slug: string): Promise<Mine | { lost: Lost }> {
  // Read through RLS, not the public door, so a tester reaches the seed gathering.
  const { data: g, error } = await supabase().from("gatherings").select("id, name").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!g) return { lost: "crowd" };
  const p = await readProfile();
  if (!p.personId) return { lost: "person" };
  return {
    personId: p.personId,
    firstName: p.firstName,
    gatheringId: g.id,
    gatheringName: g.name,
    permanent: p.permanent,
    hasPrivate: p.hasPrivate,
    hasPhoto: p.hasPhoto,
    neighbourhood: p.neighbourhood,
    tags: await loadTags(p.personId),
  };
}

// "Where" was skipped on this visit. Kept for the tab, because Apple and Google leave
// the page and come back — a skip must not be asked again on the return.
const SKIPPED = (slug: string) => `pind.where.skipped.${slug}`;
function skippedWhere(slug: string): boolean {
  if (Platform.OS !== "web") return false;
  try {
    return sessionStorage.getItem(SKIPPED(slug)) === "1";
  } catch {
    return false;
  }
}
function rememberSkip(slug: string) {
  if (Platform.OS !== "web") return;
  try {
    sessionStorage.setItem(SKIPPED(slug), "1");
  } catch {
    // No storage: the skip holds for this page only.
  }
}

const RETURN_SAYS = {
  "merge-failed": OPTIN_COPY.nothingLost,
  "link-failed": "That sign-in didn't go through, and nothing was changed. Try again, or use another way.",
} as const;

export default function OptIn() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const [step, setStep] = useState<Step>("loading");
  const [mine, setMine] = useState<Mine | null>(null);
  const [lost, setLost] = useState<Lost | null>(null);
  const [whereDone, setWhereDone] = useState(() => skippedWhere(slug));
  // Why they are on this step when they did not choose it — the gate's refusal, or what
  // a merged account still needs — said at the top of the step that fixes it.
  const [why, setWhy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasAccount, setHasAccount] = useState<Provider | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [busy, setBusy] = useState(false);

  // Read, then choose the step. `skipDone` lets a step that just finished count before
  // its state update lands.
  const advance = useCallback(
    async (opts: { whereNow?: boolean } = {}) => {
      const next = await readMine(slug);
      if ("lost" in next) {
        setMine(null);
        setLost(next.lost);
        setStep("lost");
        return null;
      }
      setMine(next);
      setLost(null);
      const done = opts.whereNow || whereDone || whereComplete({ neighbourhood: next.neighbourhood, tagCount: next.tags.length });
      setStep(nextOptInStep({ ...next, whereDone: done }));
      return next;
    },
    [slug, whereDone],
  );

  const load = useCallback(async () => {
    // Before reading anything: finish a merge the page left to sign in for, or hear how
    // a link attempt with Apple or Google came back.
    const back = await finishWebReturn();
    if (back.kind === "has-account") setHasAccount(back.provider);
    if (back.kind === "merge-failed" || back.kind === "link-failed") setNotice(RETURN_SAYS[back.kind]);
    const now = await advance();
    // The account keeps its own profile; say plainly what it still needs.
    if (back.kind === "merged" && now) setWhy(optInMissing(now).says);
  }, [advance]);

  useEffect(() => {
    load().catch((err) => {
      report(err, "open A27");
      setMine(null);
      setLost("failed");
      setStep("lost");
    });
    // Once, on arrival: every later step calls advance() itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const afterStep = (opts: { whereNow?: boolean } = {}) => {
    setWhy(null);
    setTrouble(null);
    advance(opts).catch((err) => {
      report(err, "A27 next step");
      setLost("failed");
      setStep("lost");
    });
  };

  // Under 19 at A27 removes everything, and the screen says so (Alex, M3.2; P103).
  const removeUnder19 = async () => {
    const { error } = await supabase().rpc("remove_me_under_19");
    if (error) throw error;
    await supabase().auth.signOut({ scope: "local" });
    setStep("removed");
  };

  // Back to the step that fixes what the gate needs, saying what it is.
  const sendBack = (fresh: Mine) => {
    const need = optInMissing(fresh);
    setMine(fresh);
    setWhy(need.says);
    setStep(need.step);
  };

  // The safety sheet, then the pin opens — the gate allows it only now.
  const finish = async () => {
    if (!accepted) return;
    setTrouble(null);
    setBusy(true);
    try {
      // Fresh, as whoever is signed in now — never the ids this screen was holding.
      const fresh = await readMine(slug);
      if ("lost" in fresh) {
        setMine(null);
        setLost(fresh.lost);
        setStep("lost");
        return;
      }
      // The gate's three facts, asked before writing: a refusal becomes a sentence
      // that names what is missing, on the step that adds it.
      if (optInMissing(fresh).missing.length) return sendBack(fresh);
      // The version accepted, on record (M3.2, P110–P112): M4.1 asks again when it changes.
      const { error: acceptError } = await supabase()
        .from("policy_acceptances")
        .upsert({ person_id: fresh.personId, version: POLICY_VERSION }, { onConflict: "person_id,version", ignoreDuplicates: true });
      if (acceptError) throw acceptError;
      const { data: opened, error } = await supabase()
        .from("pins")
        .update({ open_to_meeting: true })
        .eq("person_id", fresh.personId)
        .eq("gathering_id", fresh.gatheringId)
        .select("id");
      if (error || !opened?.length) {
        // The gate said no after all (something changed between the read and the
        // write): read again and say what, rather than "not allowed".
        const again = await readMine(slug);
        if (!("lost" in again) && optInMissing(again).missing.length) return sendBack(again);
        throw error ?? new Error("the pin did not open");
      }
      // Into the who's-going page (A9): the faces this opens up.
      router.replace(`/crowd/${slug}`);
    } catch (err) {
      setTrouble(failed("open you to meeting", err));
    } finally {
      setBusy(false);
    }
  };

  if (step === "loading") {
    return (
      <AppScreen scroll={false}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      </AppScreen>
    );
  }

  if (step === "removed") {
    return (
      <AppScreen>
        <Heading>{OPTIN_COPY.heading}</Heading>
        <Body>{OPTIN_COPY.under19Removed}</Body>
      </AppScreen>
    );
  }

  return (
    <AppScreen>
      {step !== "where" ? <Heading>{step === "identity" ? OPTIN_COPY.contactHeading : step === "safety" ? OPTIN_COPY.safetyHeading : OPTIN_COPY.heading}</Heading> : null}
      {step !== "where" ? (
        <View style={{ marginBottom: spacing.lg }}>
          <Body muted>{mine ? `${mine.firstName} · ${mine.gatheringName}` : ""}</Body>
          {step === "you" ? <Body muted>{OPTIN_COPY.lede}</Body> : null}
          {step === "identity" ? <Body muted>{OPTIN_COPY.contactWhy}</Body> : null}
        </View>
      ) : null}

      {step === "lost" && lost ? (
        <View style={{ gap: spacing.md }}>
          <Body>{LOST_SAYS[lost]}</Body>
          {lost === "person" ? (
            <Button label="Pin in" onPress={() => router.replace(`/pin/${slug}`)} />
          ) : lost === "failed" ? (
            <Button
              label="Try again"
              onPress={() => {
                setStep("loading");
                load().catch(() => {
                  setLost("failed");
                  setStep("lost");
                });
              }}
            />
          ) : (
            <Button label="This week's crowds" onPress={() => void Linking.openURL(`${SITE}/`)} />
          )}
        </View>
      ) : null}

      {why && step !== "safety" && step !== "lost" ? (
        <View style={styles.why}>
          <Body>{why}</Body>
        </View>
      ) : null}

      {step === "you" && mine ? (
        <YouStep
          firstName={mine.firstName}
          hasPrivate={mine.hasPrivate}
          hasPhoto={mine.hasPhoto}
          photoRequired
          onUnder19={removeUnder19}
          onSaved={() => afterStep()}
        />
      ) : null}

      {step === "where" && mine ? (
        <WhereStep
          personId={mine.personId}
          neighbourhood={mine.neighbourhood}
          tags={mine.tags}
          onDone={(saved) => {
            if (!saved) rememberSkip(slug);
            setWhereDone(true);
            afterStep({ whereNow: true });
          }}
        />
      ) : null}

      {step === "identity" ? (
        <IdentityStep
          mode="link"
          returnTo={`/opt-in/${slug}`}
          hasAccount={hasAccount}
          notice={notice}
          onDone={() => {
            setHasAccount(null);
            setNotice(null);
            afterStep({ whereNow: true });
          }}
        />
      ) : null}

      {step === "safety" ? (
        <>
          <View style={styles.sheet}>
            {OPTIN_COPY.safety.map((line) => (
              <Body key={line}>{`•  ${line}`}</Body>
            ))}
          </View>
          <Tick label={OPTIN_COPY.accept} value={accepted} onChange={setAccepted} />
          <View style={{ flexDirection: "row", gap: spacing.md, marginBottom: spacing.md }}>
            <Button kind="quiet" label="Privacy" onPress={() => void Linking.openURL(`${SITE}/privacy`)} />
            <Button kind="quiet" label="Terms" onPress={() => void Linking.openURL(`${SITE}/terms`)} />
          </View>
          {trouble ? <Trouble what={trouble} onRetry={finish} busy={busy} /> : null}
          <Button label={OPTIN_COPY.finish} busy={busy} disabled={!accepted} onPress={finish} />
        </>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  why: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.accent,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  sheet: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    marginBottom: spacing.md,
  },
});
