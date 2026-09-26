// A3 — Neighbourhood and tags (store path).
//
// **The step is the shared "where" step** (components/profile/WhereStep.tsx), drawn by
// A27 too: the neighbourhood from the fixed list (H4 — Pin'd never asks where you are),
// at least three tags as conversation handles (never match criteria), and Skip as a real
// button. Anything skipped is named on Profile afterwards (profileGaps).
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";
import { colors as palette, Said, spacing } from "@pind/shared";
import { AppScreen } from "@/components/AppScreen";
import { WhereStep } from "@/components/profile/WhereStep";
import { Trouble } from "@/components/Trouble";
import { failed, type Described } from "@/lib/errors";
import { readProfile } from "@/lib/profile";
import { loadTags } from "@/lib/tags";
import type { Picked } from "@/components/TagPicker";

export default function Where() {
  const router = useRouter();
  const [person, setPerson] = useState<{ id: string; neighbourhood: string | null; tags: Picked[] } | null>(null);
  const [trouble, setTrouble] = useState<Described | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setTrouble(null);
    (async () => {
      const p = await readProfile();
      // Signed in, but A2 never saved: the true sentence, not "expired".
      if (!p.personId) throw new Said("Your profile from the last screen is not saved yet. Go back a step and tap Continue again.");
      // What is already there is shown, never overwritten by an empty picker.
      const tags = await loadTags(p.personId);
      if (live) setPerson({ id: p.personId, neighbourhood: p.neighbourhood, tags });
    })()
      .catch((err) => live && setTrouble(failed("open this step", err)));
    return () => {
      live = false;
    };
  }, [attempt]);

  return (
    <AppScreen edges={["top", "bottom"]}>
      {trouble ? (
        <Trouble what={trouble} onRetry={() => setAttempt((n) => n + 1)} />
      ) : !person ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={palette.textMuted} />
      ) : (
        <WhereStep personId={person.id} neighbourhood={person.neighbourhood} tags={person.tags} onDone={() => router.replace("/crowds")} />
      )}
    </AppScreen>
  );
}
