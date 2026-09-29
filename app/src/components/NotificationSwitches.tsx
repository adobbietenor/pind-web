// A23's notification switches (M3.3; spec A18, six). Each is on unless switched off —
// there is no row until someone switches one off. The same six, in the same words, as
// the Worker's "stop these" links (packages/shared/src/notify.ts; N08 compares them with
// the database's list).
import { useEffect, useState } from "react";
import { View } from "react-native";
import { NOTIFICATIONS, spacing, type NotificationKind } from "@pind/shared";
import { Trouble } from "@/components/Trouble";
import { Body, Tick } from "@/components/ui";
import { failed, type Described } from "@/lib/errors";
import { readProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";

type Switches = Record<NotificationKind, boolean>;
const ALL_ON = Object.fromEntries(NOTIFICATIONS.map((n) => [n.kind, true])) as Switches;

export function NotificationSwitches() {
  const [personId, setPersonId] = useState<string | null>(null);
  const [on, setOn] = useState<Switches | null>(null);
  const [hasRow, setHasRow] = useState(false);
  const [trouble, setTrouble] = useState<Described | null>(null);

  useEffect(() => {
    (async () => {
      const me = await readProfile();
      if (!me.personId) return;
      const { data, error } = await supabase().from("notification_settings").select("*").eq("person_id", me.personId).maybeSingle();
      if (error) throw error;
      setPersonId(me.personId);
      setHasRow(!!data);
      setOn(data ? (Object.fromEntries(NOTIFICATIONS.map((n) => [n.kind, (data as unknown as Record<NotificationKind, boolean>)[n.kind]])) as Switches) : ALL_ON);
    })().catch((err) => setTrouble(failed("load your notification settings", err)));
  }, []);

  const flip = async (kind: NotificationKind, value: boolean) => {
    if (!personId || !on) return;
    setTrouble(null);
    const was = on;
    setOn({ ...on, [kind]: value });
    const db = supabase();
    // Insert or update, never upsert (the M3.1 lesson): the update grant covers the six
    // switches only.
    const change = { [kind]: value } as Partial<Switches>;
    const { error } = hasRow
      ? await db.from("notification_settings").update(change).eq("person_id", personId)
      : await db.from("notification_settings").insert({ person_id: personId, ...change });
    if (error) {
      setOn(was);
      setTrouble(failed("save that", error));
      return;
    }
    setHasRow(true);
  };

  if (!personId && !trouble) return null;
  return (
    <View style={{ gap: spacing.xs }}>
      {trouble ? <Trouble what={trouble} /> : null}
      {on
        ? NOTIFICATIONS.map((n) => (
            <View key={n.kind}>
              <Tick label={n.label} value={on[n.kind]} onChange={(v) => void flip(n.kind, v)} />
              <View style={{ marginTop: -spacing.xs, marginBottom: spacing.xs }}>
                <Body muted>{n.what}</Body>
              </View>
            </View>
          ))
        : null}
    </View>
  );
}
