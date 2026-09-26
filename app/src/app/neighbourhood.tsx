// Profile → Neighbourhood (A21, M3.2).
//
// Neighbourhood could only be set on A3, and Profile could not edit it — so a person who
// picked wrong was stuck with it, and a link-path person who never saw A3 could never set
// one at all (Alex, M3.2). The same picker as A3 and A27's "where" step, with what you
// already have selected; tapping the chosen one again clears it.
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { colors as palette, Said, spacing } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { NeighbourhoodPicker } from "@/components/profile/NeighbourhoodPicker";
import { Trouble } from "@/components/Trouble";
import { Body, Button, Heading } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { readProfile, saveNeighbourhood } from "@/lib/profile";

export default function EditNeighbourhood() {
  const router = useRouter();
  const [personId, setPersonId] = useState<string | null>(null);
  const [hood, setHood] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [saveTrouble, setSaveTrouble] = useState<Described | null>(null);
  const [attempt, setAttempt] = useState(0);

  // A load that failed is not "no neighbourhood" (M3.1, airplane mode).
  useEffect(() => {
    let live = true;
    setTrouble(null);
    readProfile()
      .then((p) => {
        if (!p.personId) throw new Said("There is no profile on this account yet.");
        if (!live) return;
        setPersonId(p.personId);
        setHood(p.neighbourhood);
      })
      .catch((err) => live && setTrouble(failed("load your neighbourhood", err)));
    return () => {
      live = false;
    };
  }, [attempt]);

  const save = async () => {
    if (!personId) return;
    setBusy(true);
    setSaveTrouble(null);
    try {
      await saveNeighbourhood(personId, hood);
      router.back();
    } catch (err) {
      setSaveTrouble(failed("save your neighbourhood", err));
      setBusy(false);
    }
  };

  return (
    <AppScreen>
      <Heading>Your neighbourhood</Heading>
      <View style={{ marginBottom: spacing.lg }}>
        <Body muted>Pin&#39;d never asks where you are. The part of town you would say you are from — it gives a crew something to start with.</Body>
      </View>
      {trouble ? (
        <Trouble what={trouble} onRetry={() => setAttempt((n) => n + 1)} />
      ) : !personId ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      ) : (
        <>
          <NeighbourhoodPicker value={hood} onChange={setHood} />
          <View style={{ marginTop: spacing.lg }}>
            {saveTrouble ? <Trouble what={saveTrouble} onRetry={save} busy={busy} /> : null}
            <Button label="Save" busy={busy} onPress={save} />
          </View>
          <View style={{ marginTop: spacing.sm }}>
            <Button kind="quiet" label="Cancel" onPress={() => router.back()} />
          </View>
        </>
      )}
    </AppScreen>
  );
}
