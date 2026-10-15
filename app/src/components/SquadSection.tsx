// A15 — squads on the pinned crowd page (M3.7), directly below the room, above 1-on-1.
// A11 is the squad's own screen (/group/[id]).
//
//   in a squad    your squad's card at the top: its name (or "checking the name", or a
//                 rename box if the name did not pass), the plan, and the way in. The list
//                 of others is hidden: one group per gathering, so nothing else to join.
//   not in one    "Squads": the ones the database lists for you, soonest first, full ones
//                 last and dimmed ("Full · 8 of 8", no Join), then "Start a squad".
//
// **Nothing here filters** (H11): `squads(G)` is written for the person asking —
// women-only inherited, blocks absent, unapproved names unlisted. Faces are the ones the
// people list already shows you; anyone else in a squad is counted, not drawn. Every
// refusal is the database's, said where the tap was (squadRefusal; decisions, "Seen is
// part of a refusal").
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { colors as palette, fonts, radius, spacing, SQUAD_COPY, SQUAD_NAME_MAX, squadNameProblem, squadSeatsLabel, squadTimes } from "@pind/shared";
import { Body, Button } from "@/components/ui";
import { failed } from "@/lib/errors";
import { soloClock } from "@/lib/solo";
import { joinSquad, loadSquads, renameSquad, startSquad, type SquadCard, type SquadsView } from "@/lib/squads";

export interface SquadFace {
  id: string;
  firstName: string;
  photoUrl: string | null;
}

export function SquadSection({ gatheringId, meId, faces, ended }: { gatheringId: string; meId: string; faces: SquadFace[]; ended: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<SquadsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ at: string; text: string } | null>(null);
  const [rename, setRename] = useState("");

  const refresh = useCallback(() => {
    loadSquads(gatheringId, meId)
      .then((v) => {
        setView(v);
        setLoadError(null);
      })
      .catch((err) => setLoadError(failed("load squads", err).says));
  }, [gatheringId, meId]);
  useEffect(refresh, [refresh]);

  // A name being checked comes back in seconds: look again while it is pending.
  useEffect(() => {
    if (view?.mine?.nameStatus !== "pending") return;
    const t = setTimeout(refresh, 4000);
    return () => clearTimeout(t);
  }, [view, refresh]);

  const act = async (at: string, run: () => Promise<unknown>, after?: () => void) => {
    setBusy(at);
    setSaid(null);
    try {
      await run();
      after?.();
    } catch (err) {
      setSaid({ at, text: failed("do that", err).says });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  if (loadError) return <Body muted>{loadError}</Body>;
  if (!view) return <ActivityIndicator style={{ marginTop: spacing.md }} color={palette.textMuted} />;

  const at = (iso: string) => soloClock(iso, view.tz);
  const saidAt = (key: string) => (said?.at === key ? <Text accessibilityRole="alert" style={styles.refusal}>{said.text}</Text> : null);
  const mine = view.mine;

  if (mine) {
    const nameProblem = squadNameProblem(rename);
    return (
      <View style={[styles.card, styles.mine]}>
        <Text style={styles.kicker}>{mine.legacy ? "Your group" : SQUAD_COPY.heading}</Text>
        {!mine.legacy ? <Text style={styles.title}>{mine.name}</Text> : null}
        {mine.nameStatus === "pending" ? <Body muted>{SQUAD_COPY.checking}</Body> : null}
        {mine.nameStatus === "rejected" ? (
          <>
            <Text accessibilityRole="alert" style={styles.refusal}>{SQUAD_COPY.rejected}</Text>
            {mine.mine ? (
              <>
                <TextInput
                  value={rename}
                  onChangeText={setRename}
                  maxLength={SQUAD_NAME_MAX + 10}
                  placeholder={SQUAD_COPY.namePlaceholder}
                  placeholderTextColor={palette.tabInactive}
                  style={styles.input}
                />
                <Button
                  label={SQUAD_COPY.rename}
                  disabled={!!nameProblem}
                  busy={busy === "rename"}
                  onPress={() => void act("rename", () => renameSquad(mine.crewId, rename.trim()), () => setRename(""))}
                />
                {rename && nameProblem ? <Text style={styles.meta}>{nameProblem}</Text> : null}
                {saidAt("rename")}
              </>
            ) : null}
          </>
        ) : null}
        {mine.meetAt ? <Body>{SQUAD_COPY.meets(mine.spot ?? SQUAD_COPY.atTheGathering.toLowerCase(), at(mine.meetAt))}</Body> : null}
        {mine.womenOnly ? <Text style={styles.tag}>{SQUAD_COPY.womenOnly}</Text> : null}
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/group/[id]", params: { id: mine.crewId } })}>
          <Text style={styles.link}>{mine.legacy ? "Open your group" : "Open your squad"}</Text>
        </Pressable>
      </View>
    );
  }

  if (ended) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{SQUAD_COPY.sectionHeading}</Text>
      <Body muted>{SQUAD_COPY.sectionHint}</Body>
      {view.squads.length === 0 ? <Body muted>{SQUAD_COPY.none}</Body> : null}
      {view.squads.map((s) => (
        <Squad key={s.crewId} squad={s} faces={faces} time={at(s.meetAt)} busy={busy === s.crewId} onJoin={() => void act(s.crewId, () => joinSquad(s.crewId))} refusal={saidAt(s.crewId)} />
      ))}
      <Button kind="quiet" label={SQUAD_COPY.start} onPress={() => { setSaid(null); setSheet(true); }} />
      {sheet ? (
        <StartSheet
          view={view}
          busy={busy === "start"}
          refusal={said?.at === "start" ? said.text : null}
          onClose={() => setSheet(false)}
          onStart={(name, spot, meetAt, womenOnly) => void act("start", () => startSquad(gatheringId, name, spot, meetAt, womenOnly), () => setSheet(false))}
        />
      ) : null}
    </View>
  );
}

function Squad({ squad, faces, time, busy, onJoin, refusal }: { squad: SquadCard; faces: SquadFace[]; time: string; busy: boolean; onJoin: () => void; refusal: ReactNode }) {
  // Faces only for members the people list already shows you; the rest are counted.
  const shown = squad.members.map((m) => faces.find((f) => f.id === m.personId)).filter((f): f is SquadFace => !!f);
  return (
    <View style={[styles.squad, squad.full && styles.dim]}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.squadName}>{squad.name}</Text>
          <Text style={styles.meta}>{`${squad.spot ?? SQUAD_COPY.atTheGathering} · ${time}`}</Text>
        </View>
        <Text style={[styles.seats, squad.full && { color: palette.textMuted }]}>{squadSeatsLabel(squad.seats)}</Text>
      </View>
      <View style={styles.faces}>
        {shown.slice(0, 6).map((f) =>
          f.photoUrl ? (
            <Image key={f.id} source={{ uri: f.photoUrl }} style={styles.face} accessibilityLabel={f.firstName} />
          ) : (
            <View key={f.id} style={[styles.face, styles.faceEmpty]}>
              <Text style={styles.faceLetter}>{f.firstName.slice(0, 1).toUpperCase()}</Text>
            </View>
          ),
        )}
        {shown.length ? <Text style={styles.meta}>{shown.map((f) => f.firstName).slice(0, 3).join(", ")}</Text> : null}
        {squad.womenOnly ? <Text style={styles.tag}>{SQUAD_COPY.womenOnly}</Text> : null}
      </View>
      {!squad.full ? <Button label={SQUAD_COPY.join} busy={busy} onPress={onJoin} /> : null}
      {refusal}
    </View>
  );
}

// Start a squad: a name (the one thing typed), a spot, a time, and who can join.
function StartSheet({
  view,
  busy,
  refusal,
  onClose,
  onStart,
}: {
  view: SquadsView;
  busy: boolean;
  refusal: string | null;
  onClose: () => void;
  onStart: (name: string, spot: string | null, meetAt: string, womenOnly: boolean) => void;
}) {
  const times = squadTimes(view.startsAt, view.endsAt);
  const [name, setName] = useState("");
  const [spot, setSpot] = useState<string | null>(view.spots.length === 1 ? view.spots[0]!.id : null);
  const [time, setTime] = useState<string | null>(null);
  const [forWomen, setForWomen] = useState(view.womenOnly.only);
  const at = (iso: string) => soloClock(iso, view.tz);
  const problem = squadNameProblem(name);
  const spotReady = view.hasSpots ? !!spot : true;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={[styles.sheet, { maxHeight: "90%" }]}>
          <ScrollView contentContainerStyle={{ gap: spacing.sm }} keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetTitle}>{SQUAD_COPY.sheetTitle}</Text>
            <Text style={styles.label}>{SQUAD_COPY.nameLabel}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              maxLength={SQUAD_NAME_MAX + 10}
              placeholder={SQUAD_COPY.namePlaceholder}
              placeholderTextColor={palette.tabInactive}
              style={styles.input}
              autoFocus
            />
            <Text style={styles.meta}>{name && problem ? problem : `${SQUAD_COPY.nameHint}  ${[...name.trim()].length}/${SQUAD_NAME_MAX}`}</Text>
            <Text style={styles.label}>{SQUAD_COPY.spot}</Text>
            {view.hasSpots ? (
              <Chips options={view.spots.map((s) => ({ key: s.id, name: s.name }))} value={spot} onChange={setSpot} />
            ) : (
              <Chips options={[{ key: "here", name: SQUAD_COPY.atTheGathering }]} value="here" onChange={() => undefined} />
            )}
            <Text style={styles.label}>{SQUAD_COPY.time}</Text>
            <Chips options={times.map((t) => ({ key: t, name: at(t) }))} value={time} onChange={setTime} />
            {view.womenOnly.eligible ? (
              <>
                <Text style={styles.label}>{SQUAD_COPY.who}</Text>
                {view.womenOnly.only ? (
                  <Text style={styles.meta}>{SQUAD_COPY.womenOnlyForced}</Text>
                ) : (
                  <Chips
                    options={[
                      { key: "everyone", name: SQUAD_COPY.whoEveryone },
                      { key: "women", name: SQUAD_COPY.whoWomenOnly },
                    ]}
                    value={forWomen ? "women" : "everyone"}
                    onChange={(k) => setForWomen(k === "women")}
                  />
                )}
              </>
            ) : null}
            <Button
              label={SQUAD_COPY.create}
              disabled={!!problem || !time || !spotReady}
              busy={busy}
              onPress={() => onStart(name.trim(), view.hasSpots ? spot : null, time!, forWomen)}
            />
            {refusal ? <Text accessibilityRole="alert" style={styles.refusal}>{refusal}</Text> : null}
            <Button kind="quiet" label="Cancel" onPress={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Chips({ options, value, onChange }: { options: { key: string; name: string }[]; value: string | null; onChange: (k: string) => void }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(o.key)} style={[styles.chip, on && styles.chipOn]}>
            <Text style={[styles.chipLabel, on && { color: palette.onAccent }]}>{o.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, backgroundColor: palette.surface, gap: spacing.sm },
  mine: { borderColor: palette.accent },
  kicker: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted },
  title: { fontFamily: fonts.headline, fontSize: 22, color: palette.text },
  heading: { fontFamily: fonts.headline, fontSize: 20, color: palette.text },
  link: { color: palette.accentText, fontSize: 15, marginTop: spacing.xs },
  squad: { padding: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.background, gap: spacing.sm },
  dim: { opacity: 0.55 },
  squadName: { fontFamily: fonts.headline, fontSize: 17, color: palette.text },
  seats: { fontSize: 13, color: palette.textTint, fontWeight: "600" },
  faces: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  face: { width: 30, height: 30, borderRadius: 15 },
  faceEmpty: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  faceLetter: { fontFamily: fonts.headline, fontSize: 13, color: palette.textMuted },
  tag: { fontSize: 12, color: palette.textTint, borderWidth: 1, borderColor: palette.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" },
  meta: { fontSize: 13, color: palette.textMuted },
  refusal: { fontSize: 14, color: "#E06B6B" },
  input: { borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: spacing.md, fontSize: 16, color: palette.text, backgroundColor: palette.surface },
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: palette.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: palette.border },
  sheetTitle: { fontFamily: fonts.headline, fontSize: 22, color: palette.text },
  label: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted, marginTop: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  chipLabel: { fontSize: 14, color: palette.text },
});
