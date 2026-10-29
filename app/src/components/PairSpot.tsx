// A29 (#17) — a pair picks its spot. Either suggests one of the venue's curated spots and a
// time; only the other's "Sounds good" makes it a plan (confirm_solo_spot). A new suggestion
// replaces the old, whoever makes it. Nothing to type: spots and times are chips, so a meeting
// is only ever at a curated public spot (Alex: the guardrail and the App Review answer).
// After the start it can no longer become a plan, and says so.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors as palette, fonts, SOLO_COPY, soloTimes, spacing } from "@pind/shared";
import { Body, Button, Choice } from "@/components/ui";
import { failed } from "@/lib/errors";
import { confirmSpot, loadPairOptions, loadPairSuggestion, soloClock, suggestSpot } from "@/lib/solo";

export function PairSpot({ crewId, gatheringId, meId, partner, onChanged }: { crewId: string; gatheringId: string; meId: string; partner: string; onChanged: () => void }) {
  const options = useQuery({ queryKey: ["pair-options", gatheringId], queryFn: () => loadPairOptions(gatheringId) });
  const suggestion = useQuery({ queryKey: ["pair-suggestion", crewId], queryFn: () => loadPairSuggestion(crewId, meId), refetchInterval: 15_000 });
  const [picking, setPicking] = useState(false);
  const [spot, setSpot] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  if (!options.data || suggestion.isPending) return <ActivityIndicator color={palette.textMuted} />;
  const o = options.data;
  const at = (iso: string) => soloClock(iso, o.tz);
  if (Date.now() >= Date.parse(o.startsAt)) return <Body muted>{SOLO_COPY.pairClosed}</Body>;
  const s = suggestion.data ?? null;

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(true);
    setSaid(null);
    try {
      await fn();
      setPicking(false);
      setSpot(null);
      setTime(null);
      void suggestion.refetch();
      onChanged();
    } catch (err) {
      setSaid(failed(what, err).says);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.section}>{SOLO_COPY.pairPick}</Text>
      {s ? <Body>{s.mine ? SOLO_COPY.pairMine(partner, s.spot, at(s.meetAt)) : SOLO_COPY.pairTheirs(partner, s.spot, at(s.meetAt))}</Body> : <Body muted>{SOLO_COPY.pairLine}</Body>}
      {s && !s.mine && !picking ? <Button label={SOLO_COPY.pairConfirm} haptic="success" busy={busy} onPress={() => void run("make it a plan", () => confirmSpot(crewId))} /> : null}
      {!picking ? (
        <Button kind="quiet" label={s ? SOLO_COPY.pairSuggestAnother : SOLO_COPY.pairSuggest} onPress={() => { setSaid(null); setPicking(true); }} />
      ) : (
        <>
          <Choice label={SOLO_COPY.sheetSpot} options={o.spots.map((x) => ({ value: x.id, name: x.name }))} value={spot} onChange={setSpot} />
          <Choice label={SOLO_COPY.sheetTime} options={soloTimes(o.startsAt, o.endsAt).map((t) => ({ value: t, name: at(t) }))} value={time} onChange={setTime} />
          <Button label={SOLO_COPY.pairSend} disabled={!spot || !time} busy={busy} onPress={() => void run("suggest that", () => suggestSpot(crewId, spot!, time!))} />
          <Button kind="quiet" label="Cancel" onPress={() => setPicking(false)} />
        </>
      )}
      {said ? <Text accessibilityRole="alert" style={styles.refusal}>{said}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontFamily: fonts.headline, fontSize: 16, color: palette.text },
  refusal: { fontSize: 14, color: "#E06B6B" },
});
