// A24 — report and block (Alex, 16 Nov 2026; spec A24; H9; Apple guideline 1.2).
//
// One sheet, drawn here once, from every person: the profile (A22), the person sheet, the
// 1-on-1 chat's header, Connections, a squad's people — and a squad itself (reportable only
// from outside it, reports_insert_on_visible_squad). Two taps: "⋯", then a reason — or Block.
//
//   * Report: a report on the PERSON, with no message's words (16 Oct 2026). The database
//     does the rest at once: out of every 1-on-1 list, your connection and chat with them end,
//     and "uncomfortable" or "under 19" hides them everywhere (two reports for the others).
//     The admin is emailed within a minute. The confirmation says a person reviews it in 24 h.
//   * Block: mutual invisibility, never told to them (H9). It ends your connection and chat,
//     calls off a 1-on-1, takes you out of a squad you share. Undone in Settings → Blocked people.
import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { A24_COPY, colors as palette, fonts, REPORT_REASONS, spacing } from "@pind/shared";
import { Sheet } from "./Sheet";
import { Tap } from "./Tap";
import { Body, Button } from "./ui";
import { blockPerson } from "@/lib/connections";
import { failed } from "@/lib/errors";
import { myPersonId, reportPerson, reportSquad, type ReportReason } from "@/lib/room";

export type ReportTarget = { kind: "person"; id: string; firstName: string } | { kind: "squad"; id: string; name: string };

// "⋯": the one way in, everywhere.
export function MoreButton({ onPress, label }: { onPress: () => void; label?: string }) {
  return (
    <Tap accessibilityRole="button" accessibilityLabel={label ?? A24_COPY.more} onPress={onPress} style={styles.more}>
      <Text style={styles.moreLabel}>⋯</Text>
    </Tap>
  );
}

export function ReportBlockSheet({
  target,
  onClose,
  onDone,
  extra,
}: {
  target: ReportTarget | null;
  onClose: () => void;
  // After a report or a block, once its confirmation is closed: the screen reads again (the
  // person may be gone from it). Not at the moment of acting, or the screen would take the
  // sheet away before its confirmation was seen (check:a24 found exactly that).
  onDone?: (what: "reported" | "blocked") => void;
  // A screen's own options, above Report (the 1-on-1 chat's: one "⋯", report still two taps).
  extra?: ReactNode;
}) {
  // What the sheet shows — a choice inside one sheet, not a page's step (S56 is about pages).
  const [mode, setMode] = useState<"choose" | "block" | "reported" | "blocked">("choose");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const close = () => {
    const done = mode === "reported" || mode === "blocked" ? mode : null;
    setMode("choose");
    setRefusal(null);
    onClose();
    if (done) onDone?.(done);
  };
  const name = target ? (target.kind === "person" ? target.firstName : target.name) : "";
  const act = async (what: "reported" | "blocked", run: (meId: string) => Promise<void>) => {
    setBusy(true);
    setRefusal(null);
    try {
      // Who I am, read fresh at the write (CLAUDE.md, "Re-read who you are").
      const meId = await myPersonId();
      if (!meId) throw new Error("not signed in");
      await run(meId);
      setMode(what);
    } catch (err) {
      setRefusal(failed(what === "reported" ? "send that report" : "block them", err).says);
    } finally {
      setBusy(false);
    }
  };
  const report = (reason: ReportReason) =>
    act("reported", (meId) => (target!.kind === "person" ? reportPerson(meId, target!.id, reason) : reportSquad(meId, target!.id, reason)));

  return (
    <Sheet visible={!!target} onClose={close}>
      {mode === "reported" ? (
        <>
          <Text style={styles.title}>{A24_COPY.reportedTitle}</Text>
          <Body>{A24_COPY.reportedLine}</Body>
          <Button label={A24_COPY.done} onPress={close} />
        </>
      ) : mode === "blocked" ? (
        <>
          <Text style={styles.title}>{A24_COPY.blockedTitle(name)}</Text>
          <Body>{A24_COPY.blockedLine}</Body>
          <Button label={A24_COPY.done} onPress={close} />
        </>
      ) : mode === "block" && target?.kind === "person" ? (
        <>
          <Text style={styles.title}>{A24_COPY.block(name)}</Text>
          <Body>{A24_COPY.blockWhat}</Body>
          <Button label={A24_COPY.blockConfirm} busy={busy} onPress={() => void act("blocked", (meId) => blockPerson(meId, target.id))} />
          <Button kind="quiet" label={A24_COPY.back} onPress={() => setMode("choose")} />
        </>
      ) : (
        <>
          {extra}
          <Text style={styles.title}>{A24_COPY.report(target?.kind === "squad" ? A24_COPY.squadNamed(name) : name)}</Text>
          <Body muted>{A24_COPY.reportHint}</Body>
          {REPORT_REASONS.map((r) => (
            <Button key={r.value} kind="quiet" label={r.label} busy={busy} onPress={() => void report(r.value)} />
          ))}
          {target?.kind === "person" ? (
            <View style={{ marginTop: spacing.sm }}>
              <Button kind="quiet" label={A24_COPY.block(name)} onPress={() => setMode("block")} />
            </View>
          ) : null}
        </>
      )}
      {refusal ? <Text accessibilityRole="alert" style={styles.refusal}>{refusal}</Text> : null}
      {mode === "choose" || mode === "block" ? <Button kind="quiet" label={A24_COPY.cancel} onPress={close} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  more: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  moreLabel: { fontSize: 22, color: palette.textMuted },
  title: { fontFamily: fonts.headline, fontSize: 20, color: palette.text },
  refusal: { fontSize: 14, color: "#F3B4B4" },
});
