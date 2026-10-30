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
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { colors as palette, fonts, radius, spacing, SQUAD_COPY, SQUAD_FORM_COPY, SQUAD_NAME_MAX, squadNameProblem, squadSeatsLabel, squadTimes } from "@pind/shared";
import { Body, Button } from "@/components/ui";
import { failed } from "@/lib/errors";
import { soloClock } from "@/lib/solo";
import { editSquad, joinSquad, loadSquads, renameSquad, startSquad, type SquadCard, type SquadsView } from "@/lib/squads";
import { SquadForm } from "./SquadForm";
import { AvatarStack } from "./Avatar";
import { Icon } from "./Icon";
import { Tap } from "./Tap";
import { Rise } from "./Motion";

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
  const [editing, setEditing] = useState(false);
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
      <View style={[styles.squad, styles.mine]}>
        <Text style={styles.kicker}>{mine.legacy ? "Your group" : SQUAD_COPY.heading}</Text>
        {!mine.legacy ? (
          <View style={styles.nameRow}>
            <Text style={styles.squadName}>{mine.name}</Text>
            {mine.womenOnly ? <Text style={styles.tag}>{SQUAD_COPY.womenOnly}</Text> : null}
          </View>
        ) : null}
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
        {mine.details ? <Text style={styles.details}>{mine.details}</Text> : null}
        {planLine(mine.spot, mine.timeNote) ? <PlaceLine text={planLine(mine.spot, mine.timeNote)!} /> : null}
        <View style={styles.cardFoot}>
          {!mine.legacy ? (
            <Tap accessibilityRole="button" onPress={() => { setSaid(null); setEditing(true); }} style={styles.editButton}>
              <Text style={styles.editLabel}>{SQUAD_FORM_COPY.edit}</Text>
            </Tap>
          ) : null}
          <View style={{ flex: 1 }} />
          <Tap accessibilityRole="button" onPress={() => router.push({ pathname: "/group/[id]", params: { id: mine.crewId } })} style={styles.openChat}>
            <Text style={styles.openChatLabel}>{mine.legacy ? "Open your group" : SQUAD_COPY.openChat}</Text>
          </Tap>
        </View>
        {saidAt("edit")}
        {editing ? (
          <SquadForm
            title={SQUAD_FORM_COPY.editTitle}
            start={{ name: mine.name, details: mine.details ?? "", place: mine.spotId, time: mine.timeNote ?? "" }}
            spots={view.spots}
            busy={busy === "edit"}
            refusal={said?.at === "edit" ? said.text : null}
            onClose={() => setEditing(false)}
            onSave={(w) => void act("edit", () => editSquad(mine.crewId, w.name, w.details, w.place && w.place !== "event" ? w.place : null, w.time), () => setEditing(false))}
          />
        ) : null}
      </View>
    );
  }

  if (ended) return null;

  return (
    <View style={styles.section}>
      {/* UI pass 1 (069): the crowd page's style. "Squads" with Start beside it, then one
          plain box per squad, so the Meeting Room stays the one purple card. */}
      <View style={styles.headRow}>
        <Text style={styles.heading}>{SQUAD_COPY.sectionHeading}</Text>
        <Tap accessibilityRole="button" onPress={() => { setSaid(null); setSheet(true); }} style={styles.startButton}>
          <Text style={styles.startLabel}>{`+ ${SQUAD_COPY.startShort}`}</Text>
        </Tap>
      </View>
      <Body muted>{SQUAD_COPY.sectionHint}</Body>
      {view.squads.length === 0 ? <Body muted>{SQUAD_COPY.none}</Body> : null}
      {view.squads.map((s, i) => (
        <Rise key={s.crewId} index={i}>
        <Squad squad={s} faces={faces} busy={busy === s.crewId} onJoin={() => void act(s.crewId, () => joinSquad(s.crewId))} refusal={saidAt(s.crewId)} />
        </Rise>
      ))}
      {sheet ? (
        <SquadForm
          title={SQUAD_FORM_COPY.startTitle}
          spots={view.spots}
          womenOnly={view.womenOnly}
          busy={busy === "start"}
          refusal={said?.at === "start" ? said.text : null}
          onClose={() => setSheet(false)}
          onSave={(w, forWomen) =>
            void act("start", () => startSquad(gatheringId, w.name, w.details, w.place && w.place !== "event" ? w.place : null, w.time, forWomen), () => setSheet(false))
          }
        />
      ) : null}
    </View>
  );
}

// The card's one grey line (069): the place and the time, only what is set.
function planLine(spot: string | null, timeNote: string | null): string | null {
  return [spot, timeNote].filter(Boolean).join(" · ") || null;
}

function Squad({ squad, faces, busy, onJoin, refusal }: { squad: SquadCard; faces: SquadFace[]; busy: boolean; onJoin: () => void; refusal: ReactNode }) {
  // Faces only for members the people list already shows you; the rest are counted.
  const shown = squad.members.map((m) => faces.find((f) => f.id === m.personId)).filter((f): f is SquadFace => !!f);
  return (
    <View style={[styles.squad, squad.full && styles.dim]}>
      <View style={styles.nameRow}>
        <Text style={styles.squadName}>{squad.name}</Text>
        {squad.womenOnly ? <Text style={styles.tag}>{SQUAD_COPY.womenOnly}</Text> : null}
      </View>
      {squad.details ? <Text style={styles.details}>{squad.details}</Text> : null}
      {planLine(squad.spot, squad.timeNote) ? <PlaceLine text={planLine(squad.spot, squad.timeNote)!} /> : null}
      <View style={styles.cardFoot}>
        <AvatarStack size={26} max={4} people={shown.map((f) => ({ id: f.id, name: f.firstName, source: f.photoUrl }))} />
        <Text style={[styles.meta, { flex: 1 }]}>{squad.full ? SQUAD_COPY.fullLine : SQUAD_COPY.count(squad.members.length, squad.members[0]?.firstName)}</Text>
        {!squad.full ? (
          <Tap accessibilityRole="button" haptic="action" disabled={busy} onPress={onJoin} style={styles.join}>
            {busy ? <ActivityIndicator color={palette.onAccent} /> : <Text style={styles.joinLabel}>{SQUAD_COPY.join}</Text>}
          </Tap>
        ) : null}
      </View>
      {refusal}
    </View>
  );
}

// Start a squad: a name (the one thing typed), a spot, a time, and who can join.
// Where and when, one grey line with a pin, only when it is set (UI pass 1, 069).
function PlaceLine({ text }: { text: string }) {
  return (
    <View style={styles.placeLine}>
      <Icon name="pin" size={14} color={palette.textMuted} />
      <Text style={styles.meta}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, backgroundColor: palette.surface, gap: spacing.sm },
  // Your squad: the same box, outlined in purple (069).
  mine: { borderColor: palette.accent, marginTop: spacing.md },
  section: { marginTop: spacing.lg, gap: spacing.sm },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  startButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  startLabel: { fontFamily: fonts.headline, fontSize: 14, color: palette.text },
  nameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  placeLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardFoot: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  join: { minHeight: 44, minWidth: 72, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: palette.accent },
  joinLabel: { fontFamily: fonts.headline, fontSize: 15, color: palette.onAccent },
  details: { fontSize: 14, lineHeight: 20, color: palette.textMuted },
  editButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md },
  editLabel: { fontSize: 15, color: palette.accentText, textDecorationLine: "underline" },
  openChat: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.accent },
  openChatLabel: { fontFamily: fonts.headline, fontSize: 15, color: palette.text },
  kicker: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted },
  title: { fontFamily: fonts.headline, fontSize: 22, color: palette.text },
  heading: { fontFamily: fonts.headline, fontSize: 20, color: palette.text },
  link: { color: palette.accentText, fontSize: 15, marginTop: spacing.xs },
  squad: { padding: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, backgroundColor: palette.surface, gap: spacing.xs + 2 },
  dim: { opacity: 0.55 },
  squadName: { fontFamily: fonts.headline, fontSize: 17, color: palette.text },
  seats: { fontSize: 13, color: palette.textTint, fontWeight: "600" },
  faces: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  face: { width: 30, height: 30, borderRadius: 15 },
  faceEmpty: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  faceLetter: { fontFamily: fonts.headline, fontSize: 13, color: palette.textMuted },
  // Women only: a small pink tag (UI pass 1, section 9's soft accent).
  tag: { fontSize: 12, color: "#F7C6DE", backgroundColor: "#3A1F2E", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden", alignSelf: "flex-start" },
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
