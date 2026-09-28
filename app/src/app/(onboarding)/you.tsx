// A2 — You (store path). First name, date of birth, gender, a face photo.
//
// **The form is the shared "you" step** (components/profile/YouStep.tsx), drawn by A27
// too — its rules (under 19 stops with no soft fail, only the year kept, gender on no
// profile, women-only asked once, a photo never a dead end) live there, once. Here is
// only what the store path has: the OAuth sign-in landing on this URL, and a returning
// person sent home rather than shown a blank form.
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { colors as palette, landingAfterSignIn, spacing } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { YouStep } from "@/components/profile/YouStep";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading } from "@/components/ui";
import { track } from "@/lib/analytics";
import { failed, type Described } from "@/lib/errors";
import { myAuthId } from "@/lib/session";
import { supabase } from "@/lib/supabase";

// The form is the shared "you" step (components/profile), the same one A27 draws
// (Alex, M3.2 walk). This route is what only the store path has: waiting for a sign-in
// that arrives with the URL, and sending a returning person home.
export default function You() {
  const router = useRouter();
  // **This screen is where an OAuth sign-in lands**, and the session arrives WITH the
  // URL rather than before it. Until M3.1 the screen assumed a session was already
  // there and, when it was not, told the person it had EXPIRED — which was both wrong
  // and alarming: it had never existed. Waiting for it, and saying the true thing if
  // it never comes, is the whole of this state.
  const [auth, setAuth] = useState<"waiting" | "ready" | "none">("waiting");
  const arrivedFromUrl = useRef(false);
  const [firstName, setFirstName] = useState("");
  const [hasPhoto, setHasPhoto] = useState(false);

  useEffect(() => {
    let live = true;
    const db = supabase();
    db.auth.getSession().then(({ data }) => {
      if (live && data.session) setAuth("ready");
    });
    // detectSessionInUrl finishes asynchronously after a return from Google or Apple;
    // this is what says it landed.
    const { data: sub } = db.auth.onAuthStateChange((_event, session) => {
      if (!live || !session) return;
      arrivedFromUrl.current = true;
      setAuth("ready");
    });
    // Bounded, so a redirect that brings nothing back ends in a sentence rather than
    // a spinner nobody can get out of.
    const giveUp = setTimeout(() => {
      if (live) setAuth((was) => (was === "waiting" ? "none" : was));
    }, 8000);
    return () => {
      live = false;
      sub.subscription.unsubscribe();
      clearTimeout(giveUp);
    };
  }, []);

  useEffect(() => {
    if (auth === "ready" && arrivedFromUrl.current) track("sign_in", { method: "oauth_web" });
  }, [auth]);

  // **A returning person never sees this form** (M3.1, from the walk): signing out on
  // one platform and in on the other landed here, blank, and looked like a lost
  // profile. Asked once the session exists; until it answers, the form waits.
  //
  // **And if it cannot answer, the screen says so** rather than showing the blank form
  // (M3.1, airplane mode): a question that failed to arrive used to read as "no
  // profile", which is the lost-profile fault again by another road.
  const [known, setKnown] = useState(false);
  const [checkTrouble, setCheckTrouble] = useState<Described | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (auth !== "ready") return;
    let live = true;
    setCheckTrouble(null);
    (async () => {
      const db = supabase();
      const id = await myAuthId();
      const { data: person, error: personError } = await db
        .from("people")
        .select("id, first_name, photo_path")
        .eq("auth_user_id", id)
        .maybeSingle();
      if (personError) throw personError;
      const { data: priv, error: privError } = person
        ? await db.from("people_private").select("person_id").eq("person_id", person.id).maybeSingle()
        : { data: null, error: null };
      if (privError) throw privError;
      if (!live) return;
      const landing = landingAfterSignIn(person ? { firstName: person.first_name, hasPrivate: !!priv } : null);
      if (landing.go === "home") {
        router.replace("/crowds");
        return;
      }
      if (landing.firstName) setFirstName((was) => was || landing.firstName);
      setHasPhoto(!!person?.photo_path);
      setKnown(true);
    })().catch((err) => live && setCheckTrouble(failed("check whether you already have a profile", err)));
    return () => {
      live = false;
    };
  }, [auth, router, attempt]);

  if (checkTrouble) {
    return (
      <AppScreen edges={["top", "bottom"]}>
        <Heading>A bit about you</Heading>
        <Trouble what={checkTrouble} onRetry={() => setAttempt((n) => n + 1)} />
      </AppScreen>
    );
  }

  if (auth === "waiting" || (auth === "ready" && !known)) {
    return (
      <AppScreen edges={["top", "bottom"]}>
        <Heading>Finishing your sign-in</Heading>
          <ActivityIndicator style={{ marginTop: spacing.lg }} color={palette.textMuted} />
        </AppScreen>
    );
  }

  if (auth === "none") {
    return (
      <AppScreen edges={["top", "bottom"]}>
        <Heading>That sign-in did not come back</Heading>
          <View style={{ marginBottom: spacing.lg }}>
            <Body muted>
              Nothing was saved, and nothing went wrong on your side. Try again — the email code is the quickest way in.
            </Body>
          </View>
          <Button label="Back to sign in" onPress={() => router.replace("/sign-in")} />
        </AppScreen>
    );
  }

  return (
    <AppScreen edges={["top", "bottom"]}>
      <Heading>A bit about you</Heading>
      <View style={{ marginBottom: spacing.lg }}>
        <Body muted>Your first name is what people see. Nothing else here is on your profile.</Body>
      </View>
      {/* The photo is optional here: a photo is needed to meet people at a gathering
          (A27, Q2 revised) — never to pin, and never to have a profile. */}
      <YouStep
        firstName={firstName}
        hasPrivate={false}
        hasPhoto={hasPhoto}
        photoRequired={false}
        onSaved={({ photo }) => {
          track("profile_created", { photo });
          router.replace("/where");
        }}
      />
    </AppScreen>
  );
}
