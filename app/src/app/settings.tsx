// A23 — Safety & settings. The M3.1 half: export my data, and delete my account.
// The notification switches (seven) and "women-only rooms only" arrived in M3.3.
// Blocked people and my reports arrive with the milestone that creates them (M3.5).
//
// **"Women-only rooms only" is a real only** (Alex, 29 Sept): shown only to someone
// eligible (a woman, or nonbinary and included), it places you in the women-only room
// and never the general one — and A9 says plainly when you are waiting for it.
//
// **The visibility line is not a setting.** "Visible only after I pin in and opt in"
// is how the product works, so it is stated, not offered — a toggle implies there is
// another way to be.
//
// **There is no location permission to manage**, because the app never asks for one
// (H4). Saying so on this screen is deliberate: the absence is invisible otherwise.
//
// **Sign out** (Alex, 10 Oct 2026): this device only, a card of its own above Delete,
// two taps. Shown only with a permanent sign-in, and refused offline (lib/auth.ts).
//
// Delete is a two-step confirm and says exactly what goes and what stays before the
// second tap. Everything in that list is Alex's decision, restated here rather than
// rediscovered (decisions Part 3, and M3.1).
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Platform, Share, StyleSheet, Text, View } from "react-native";
import { colors as palette, fonts, radius, SIGN_OUT, spacing, WOMEN_ONLY_COPY } from "@pind/shared";
import { NotificationSwitches } from "@/components/NotificationSwitches";
import { AppScreen } from "@/components/AppScreen";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading, Notice, Tick } from "@/components/ui";
import { switchWomenOnlyRooms, womenOnlyRooms } from "@/lib/after";
import { failed, type Described } from "@/lib/errors";
import { signOutHere } from "@/lib/auth";
import { deleteAccount, exportMyData, readProfile } from "@/lib/profile";

export default function Settings() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Described | null>(null);
  const [done, setDone] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [womenOnly, setRoomsOnly] = useState<{ eligible: boolean; on: boolean } | null>(null);
  const [roomsTrouble, setRoomsTrouble] = useState<Described | null>(null);
  // Sign out shows only with a permanent sign-in, read fresh on every focus (Alex, 10 Oct
  // 2026: an anonymous person has nothing to sign back into — their way out is Delete).
  const [permanent, setPermanent] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutTrouble, setSignOutTrouble] = useState<Described | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void readProfile()
        .then((me) => {
          if (live) setPermanent(me.permanent);
          return me.personId ? womenOnlyRooms(me.personId) : null;
        })
        .then((w) => live && setRoomsOnly(w))
        .catch(() => {
          if (!live) return;
          setRoomsOnly(null);
          setPermanent(false);
        });
      return () => {
        live = false;
      };
    }, []),
  );

  const flipWomenOnly = async (on: boolean) => {
    setRoomsTrouble(null);
    setBusy("women-only");
    try {
      await switchWomenOnlyRooms(on);
      setRoomsOnly((w) => (w ? { ...w, on } : w));
    } catch (err) {
      setRoomsTrouble(failed("change that", err));
    } finally {
      setBusy(null);
    }
  };

  const runExport = async () => {
    setBusy("export");
    setError(null);
    setDone("");
    try {
      const data = await exportMyData();
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS === "web") {
        // A real download, because "export my data" that shows you a wall of text is
        // not an export.
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `pind-my-data-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ message: json });
      }
      setDone("That is everything we hold about you.");
    } catch (err) {
      setError(failed("put your data together", err));
    } finally {
      setBusy(null);
    }
  };

  // Offline, nothing changes and the card says so with Try again (Alex, 10 Oct 2026): a
  // sign-out never leaves this phone receiving the account's notifications.
  const runSignOut = async () => {
    setBusy("sign-out");
    setSignOutTrouble(null);
    try {
      await signOutHere();
      router.replace("/crowds");
    } catch (err) {
      setSignOutTrouble(failed("sign you out", err));
      setBusy(null);
    }
  };

  const runDelete = async () => {
    setBusy("delete");
    setError(null);
    try {
      await deleteAccount();
      router.replace("/crowds");
    } catch (err) {
      setError(failed("delete your account", err));
      setBusy(null);
    }
  };

  return (
    <AppScreen edges={["top", "bottom"]}>
        <Heading>Safety &amp; settings</Heading>

        {/* No Try again here: the Export and Delete buttons below are the retry, and a
            second Delete button at the top would be one tap too easy. A sign-out still
            comes with its Sign in button. */}
        {error ? <Trouble what={error} /> : null}
        {done ? <Notice>{done}</Notice> : null}

        <Text style={styles.sectionName}>Who can see you</Text>
        <View style={styles.card}>
          <Body>Visible only after you pin in and say you would like to meet — always on.</Body>
          <View style={{ marginTop: spacing.sm }}>
            <Body muted>
              Not a setting, because there is no other way to be. Nobody sees your name or your photo until you have both pinned
              in to the same gathering and both said you would like to meet.
            </Body>
          </View>
          <View style={{ marginTop: spacing.md }}>
            <Body muted>There is no location permission to manage. Pin&#39;d never asks where you are.</Body>
          </View>
        </View>

        {womenOnly?.eligible ? (
          <>
            <Text style={styles.sectionName}>Safety</Text>
            <View style={styles.card}>
              <Tick label={WOMEN_ONLY_COPY.setting} value={womenOnly.on} onChange={(v) => void flipWomenOnly(v)} />
              <Body muted>{WOMEN_ONLY_COPY.settingWhat}</Body>
              {roomsTrouble ? <Trouble what={roomsTrouble} /> : null}
            </View>
          </>
        ) : null}

        <Text style={styles.sectionName}>Notifications</Text>
        <View style={styles.card}>
          <Body muted>By push on the app, and by email when you use Pin&#39;d on the web.</Body>
          <View style={{ marginTop: spacing.md }}>
            <NotificationSwitches />
          </View>
        </View>

        <Text style={styles.sectionName}>Your data</Text>
        <View style={styles.card}>
          <Body muted>
            A JSON file of everything we hold about you, read with your own account so it shows exactly what you can see. The
            reports are the ones you filed — your reason and the date, not the moderation decision, which is not yours.
          </Body>
          <View style={{ marginTop: spacing.md }}>
            <Button kind="quiet" label="Export my data" busy={busy === "export"} onPress={runExport} />
          </View>
        </View>

        {/* Sign out sits above Delete in a card of its own: the two must never be
            mistaken for each other. */}
        {permanent ? (
          <>
            <Text style={styles.sectionName}>{SIGN_OUT.heading}</Text>
            <View style={styles.card}>
              <Body muted>{SIGN_OUT.line}</Body>
              {signOutTrouble ? (
                <View style={{ marginTop: spacing.md }}>
                  <Trouble what={signOutTrouble} onRetry={() => void runSignOut()} busy={busy === "sign-out"} />
                </View>
              ) : null}
              {!signingOut ? (
                <View style={{ marginTop: spacing.md }}>
                  <Button kind="quiet" label={SIGN_OUT.start} onPress={() => setSigningOut(true)} />
                </View>
              ) : (
                <>
                  {Platform.OS !== "web" ? (
                    <View style={{ marginTop: spacing.md }}>
                      <Body>{SIGN_OUT.phone}</Body>
                    </View>
                  ) : null}
                  <View style={{ marginTop: spacing.md }}>
                    <Button label={SIGN_OUT.yes} busy={busy === "sign-out"} onPress={() => void runSignOut()} />
                  </View>
                  <View style={{ marginTop: spacing.sm }}>
                    <Button kind="quiet" label={SIGN_OUT.no} onPress={() => setSigningOut(false)} />
                  </View>
                </>
              )}
            </View>
          </>
        ) : null}

        <Text style={styles.sectionName}>Delete your account</Text>
        <View style={styles.card}>
          {!confirming ? (
            <>
              <Body muted>This cannot be undone.</Body>
              <View style={{ marginTop: spacing.md }}>
                <Button kind="quiet" label="Delete my account" onPress={() => setConfirming(true)} />
              </View>
            </>
          ) : (
            <>
              <Body>What goes</Body>
              <View style={{ marginTop: spacing.xs }}>
                <Body muted>
                  Your sign-in, your profile, your photo, your pins, your tags, your crews, your connections and the blocks you
                  made.
                </Body>
              </View>
              <View style={{ marginTop: spacing.md }}>
                <Body>What stays, and why</Body>
              </View>
              <View style={{ marginTop: spacing.xs }}>
                <Body muted>
                  Reports about you or by you, for twelve months, with your name removed — so a safety record does not disappear
                  when someone deletes an account.
                </Body>
              </View>
              <View style={{ marginTop: spacing.sm }}>
                <Body muted>
                  Anything you wrote in a crew stays in that crew&#39;s conversation, shown as &ldquo;someone who left&rdquo;.
                  Removing your lines would rewrite a conversation other people are still reading.
                </Body>
              </View>
              <View style={{ marginTop: spacing.lg }}>
                <Button label="Yes, delete everything" busy={busy === "delete"} onPress={runDelete} />
              </View>
              <View style={{ marginTop: spacing.sm }}>
                <Button kind="quiet" label="Keep my account" onPress={() => setConfirming(false)} />
              </View>
            </>
          )}
        </View>

        <Text style={styles.sectionName}>Coming with the rest</Text>
        <View style={styles.card}>
          <Body muted>
            Blocked people and the reports you have filed arrive with the safety tools.
          </Body>
        </View>
      </AppScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  body: { padding: spacing.lg, paddingBottom: spacing.xl },
  card: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  sectionName: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted, marginBottom: spacing.sm },
});
