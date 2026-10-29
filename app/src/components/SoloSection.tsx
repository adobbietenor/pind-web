// A28 / A29 — 1-on-1 on the pinned crowd page (M3.4), below the room and groups.
//
//   off           "Meet 1-on-1", what it is beside groups, and one tap to the sheet (A28):
//                 optional, the venue's public spots only, and a forced choice of who can
//                 see you — no default, nothing pre-selected.
//   on            the people the database lets you see in 1-on-1, each with "Propose a
//                 meet" or "Sent"; proposals to you, to answer; how many of your 3 are open.
//   a plan        the plan card, to the plan's own screen (thread, "I'm here", A16).
//
// **No free text anywhere** (decisions, "M3.4: who can see whom"): a proposal is a spot
// from the venue's list, a time from soloTimes() and one of five lines. A decline sends
// nothing, and to the sender an unanswered proposal and a declined one look the same.
// Every refusal is the database's, said in words where the tap was (soloRefusal).
// Not shown at all where 1-on-1 is not offered: no spots, or switched off on this
// platform by the admin (decisions Part 5).
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  colors as palette,
  fonts,
  radius,
  SOLO_COPY,
  SOLO_MAX_OPEN,
  soloLine,
  soloLinesFor,
  soloProposalsOpen,
  soloTimes,
  spacing,
} from "@pind/shared";
import { Body, Button, Choice } from "@/components/ui";
import { womenOnlyRooms } from "@/lib/after";
import { failed } from "@/lib/errors";
import { answerSolo, loadSolo, proposeSolo, setSolo, soloClock, withdrawSolo, type SoloChoice, type SoloView } from "@/lib/solo";
import { Tap } from "./Tap";
import { Rise } from "./Motion";

export interface SoloFace {
  id: string;
  firstName: string;
  photoUrl: string | null;
  tags: string;
}

export function SoloSection({ gatheringId, pinId, meId, faces, ended }: { gatheringId: string; pinId: string; meId: string; faces: SoloFace[]; ended: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<SoloView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [choice, setChoice] = useState<SoloChoice | null>(null);
  const [proposing, setProposing] = useState<SoloFace | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // A refusal, keyed by where the tap was ("switch", "sheet", a person or a proposal id).
  const [said, setSaid] = useState<{ at: string; text: string } | null>(null);

  // Whether "women only" is this person's to choose — false until read, so it is never
  // offered on a guess.
  const [eligible, setEligible] = useState(false);
  useEffect(() => {
    let on = true;
    womenOnlyRooms(meId)
      .then((w) => on && setEligible(w.eligible))
      .catch(() => on && setEligible(false));
    return () => {
      on = false;
    };
  }, [meId]);

  const refresh = useCallback(() => {
    loadSolo(gatheringId, meId)
      .then((v) => {
        setView(v);
        setLoadError(null);
      })
      .catch((err) => setLoadError(failed("load 1-on-1", err).says));
  }, [gatheringId, meId]);
  useEffect(refresh, [refresh]);

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
  // Not offered here: say nothing — except to someone already on, who must be able to turn it off.
  if ((!view.offered || ended) && !view.choice) return null;

  const open = soloProposalsOpen(view.startsAt);
  const at = (iso: string) => soloClock(iso, view.tz);
  const faceOf = (id: string) => faces.find((f) => f.id === id);
  const sentTo = new Map(view.sent.map((p) => [p.personId, p]));
  const saidAt = (key: string) => (said?.at === key ? <Text accessibilityRole="alert" style={styles.refusal}>{said.text}</Text> : null);

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{SOLO_COPY.sectionHeading}</Text>

      {!view.choice ? (
        // A28 — off: what it is, beside groups, and the sheet.
        <>
          <Body muted>{SOLO_COPY.groupsVsSolo}</Body>
          <Button kind="quiet" label={SOLO_COPY.label} onPress={() => { setChoice(null); setSaid(null); setSheet(true); }} />
        </>
      ) : view.plan ? (
        // The plan card.
        <Tap feel="card" accessibilityRole="button" onPress={() => router.push({ pathname: "/group/[id]", params: { id: view.plan!.crewId } })} style={({ pressed }) => [styles.plan, pressed && { opacity: 0.8 }]}>
          <Text style={styles.planHeading}>{SOLO_COPY.planHeading(view.plan.partner)}</Text>
          {view.plan.spot && view.plan.meetAt ? <Body>{SOLO_COPY.planWhere(view.plan.spot, at(view.plan.meetAt))}</Body> : null}
          <Text style={styles.link}>{SOLO_COPY.openPlan}</Text>
        </Tap>
      ) : (
        <>
          {/* Proposals to you, to answer. */}
          {view.received.map((p) => {
            const f = faceOf(p.personId);
            return (
              <View key={p.id} style={styles.received}>
                <View style={styles.row}>
                  <Face face={f} name={p.firstName} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{`${p.firstName} ${SOLO_COPY.received}`}</Text>
                    <Body>{soloLine(p.line, p.spot, at(p.meetAt))}</Body>
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button label={SOLO_COPY.accept} haptic="action" busy={busy === p.id} onPress={() => void act(p.id, () => answerSolo(p.id, true))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button kind="quiet" label={SOLO_COPY.decline} onPress={() => void act(p.id, () => answerSolo(p.id, false))} />
                  </View>
                </View>
                <Text style={styles.meta}>{SOLO_COPY.declineNote}</Text>
                {saidAt(p.id)}
              </View>
            );
          })}

          {!open ? <Body muted>{SOLO_COPY.closedAtStart}</Body> : null}
          {open && view.people.length === 0 && view.received.length === 0 ? <Body muted>{SOLO_COPY.nobodyYet}</Body> : null}
          {open
            ? view.people.map((id, i) => {
                const f = faceOf(id);
                if (!f) return null;
                const sent = sentTo.get(id);
                return (
                  <Rise key={id} index={i} style={styles.personRow}>
                    <View style={styles.row}>
                      <Face face={f} name={f.firstName} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name}>{f.firstName}</Text>
                        {f.tags ? <Text style={styles.meta}>{f.tags}</Text> : null}
                        {sent ? <Text style={styles.sent}>{`${SOLO_COPY.sent} · ${soloLine(sent.line, sent.spot, at(sent.meetAt))}`}</Text> : null}
                      </View>
                    </View>
                    {sent ? (
                      <>
                        <Text style={styles.meta}>{SOLO_COPY.sentNote}</Text>
                        <Button kind="quiet" label={SOLO_COPY.withdraw} busy={busy === sent.id} onPress={() => void act(sent.id, () => withdrawSolo(sent.id))} />
                        {saidAt(sent.id)}
                      </>
                    ) : (
                      <Button
                        kind="quiet"
                        label={SOLO_COPY.propose}
                        disabled={view.sent.length >= SOLO_MAX_OPEN}
                        onPress={() => { setSaid(null); setProposing(f); }}
                      />
                    )}
                  </Rise>
                );
              })
            : null}
          {open && view.sent.length ? <Text style={styles.meta}>{SOLO_COPY.openCount(view.sent.length)}</Text> : null}
        </>
      )}

      {view.choice ? (
        <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
          <Text style={styles.meta}>{`Who can see you: ${view.choice === "women_only" ? SOLO_COPY.womenOnly : SOLO_COPY.everyone}`}</Text>
          {!view.plan ? (
            <>
              <Button kind="quiet" label={SOLO_COPY.turnOff} busy={busy === "switch"} onPress={() => void act("switch", () => setSolo(pinId, null))} />
              <Text style={styles.meta}>{SOLO_COPY.offNote}</Text>
              {saidAt("switch")}
            </>
          ) : null}
        </View>
      ) : null}

      {/* A28 — the sheet: optional, the venue's spots only, and a forced choice. */}
      <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)}>
        <View style={styles.scrim}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{SOLO_COPY.sheetTitle}</Text>
            <Body>{SOLO_COPY.sheetLine}</Body>
            {/* "Women only" only for whom it is (R1, M4.2): offered to anyone else, the
                difference in who they were shown read off everyone's gender. Still a forced
                choice — nothing pre-selected — even when it is the one option. */}
            <Choice<SoloChoice>
              label=""
              options={[
                { value: "everyone", name: SOLO_COPY.everyone },
                ...(eligible ? [{ value: "women_only" as const, name: SOLO_COPY.womenOnly }] : []),
              ]}
              value={choice}
              onChange={setChoice}
            />
            {choice === "women_only" ? <Text style={styles.meta}>{SOLO_COPY.womenOnlyNote}</Text> : null}
            <Button
              label={SOLO_COPY.turnOn}
              disabled={!choice}
              busy={busy === "sheet"}
              onPress={() => void act("sheet", () => setSolo(pinId, choice!), () => setSheet(false))}
            />
            {saidAt("sheet")}
            <Button kind="quiet" label="Not now" onPress={() => setSheet(false)} />
          </View>
        </View>
      </Modal>

      {proposing ? (
        <ProposalSheet
          view={view}
          to={proposing}
          busy={busy === proposing.id}
          refusal={said?.at === proposing.id ? said.text : null}
          onClose={() => setProposing(null)}
          onSend={(spotId, meetAt, line) => void act(proposing.id, () => proposeSolo(gatheringId, proposing.id, spotId, meetAt, line), () => setProposing(null))}
        />
      ) : null}
    </View>
  );
}

// The proposal: a spot, a time and a line — three sets of chips, nothing to type.
function ProposalSheet({
  view,
  to,
  busy,
  refusal,
  onClose,
  onSend,
}: {
  view: SoloView;
  to: SoloFace;
  busy: boolean;
  refusal: string | null;
  onClose: () => void;
  onSend: (spotId: string, meetAt: string, line: number) => void;
}) {
  const times = soloTimes(view.startsAt, view.endsAt);
  const [spot, setSpot] = useState<string | null>(view.spots.length === 1 ? view.spots[0]!.id : null);
  const [time, setTime] = useState<string | null>(null);
  const [line, setLine] = useState<number | null>(null);
  const at = (iso: string) => soloClock(iso, view.tz);
  const lines = time ? soloLinesFor(time, view.startsAt) : [];
  const spotName = view.spots.find((s) => s.id === spot)?.name ?? "…";
  // A line worded for before stops fitting when the time moves after the start.
  useEffect(() => {
    if (line && !lines.some((l) => l.n === line)) setLine(null);
  }, [time]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={[styles.sheet, { maxHeight: "88%" }]}>
          <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
            <Text style={styles.sheetTitle}>{`Meet ${to.firstName}`}</Text>
            {view.group ? (
              <Text style={styles.meta}>{view.group.spot && view.group.meetAt ? SOLO_COPY.yourGroup(view.group.spot, at(view.group.meetAt)) : SOLO_COPY.yourGroupAtStart}</Text>
            ) : null}
            <Text style={styles.label}>{SOLO_COPY.sheetSpot}</Text>
            <Chips options={view.spots.map((s) => ({ key: s.id, name: s.name }))} value={spot} onChange={setSpot} />
            <Text style={styles.label}>{SOLO_COPY.sheetTime}</Text>
            <Chips options={times.map((t) => ({ key: t, name: at(t) }))} value={time} onChange={setTime} />
            {time ? (
              <>
                <Text style={styles.label}>{SOLO_COPY.sheetLinePick}</Text>
                {lines.map((l) => {
                  const on = l.n === line;
                  return (
                    <Tap key={l.n} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setLine(l.n)} style={[styles.lineChoice, on && styles.lineOn]}>
                      <Text style={styles.lineText}>{l.text(spotName, at(time))}</Text>
                    </Tap>
                  );
                })}
              </>
            ) : null}
            <Button label={SOLO_COPY.sheetSend} haptic="action" disabled={!spot || !time || !line} busy={busy} onPress={() => onSend(spot!, time!, line!)} />
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
          <Tap key={o.key} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(o.key)} style={[styles.chip, on && styles.chipOn]}>
            <Text style={[styles.chipLabel, on && { color: palette.onAccent }]}>{o.name}</Text>
          </Tap>
        );
      })}
    </View>
  );
}

function Face({ face, name }: { face: SoloFace | undefined; name: string }) {
  return face?.photoUrl ? (
    <Image source={{ uri: face.photoUrl }} style={styles.face} />
  ) : (
    <View style={[styles.face, styles.faceEmpty]}>
      <Text style={styles.faceLetter}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, backgroundColor: palette.surface, gap: spacing.sm },
  heading: { fontFamily: fonts.headline, fontSize: 20, color: palette.text },
  plan: { padding: spacing.md, borderWidth: 1, borderColor: palette.accent, borderRadius: radius.md, gap: spacing.xs },
  planHeading: { fontFamily: fonts.headline, fontSize: 18, color: palette.text },
  link: { color: palette.accentText, fontSize: 14 },
  received: { padding: spacing.md, borderWidth: 1, borderColor: palette.accent, borderRadius: radius.md, gap: spacing.sm },
  personRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.border, gap: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  face: { width: 44, height: 44, borderRadius: 22 },
  faceEmpty: { backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  faceLetter: { fontFamily: fonts.headline, fontSize: 18, color: palette.textMuted },
  name: { fontFamily: fonts.headline, fontSize: 16, color: palette.text },
  meta: { fontSize: 13, color: palette.textMuted },
  sent: { fontSize: 13, color: palette.textTint, marginTop: 2 },
  refusal: { fontSize: 14, color: "#E06B6B" },
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: palette.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: palette.border },
  sheetTitle: { fontFamily: fonts.headline, fontSize: 22, color: palette.text },
  label: { fontFamily: fonts.headline, fontSize: 14, color: palette.textMuted, marginTop: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  chipLabel: { fontSize: 14, color: palette.text },
  lineChoice: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  lineOn: { borderColor: palette.accent },
  lineText: { fontSize: 15, color: palette.text },
});
