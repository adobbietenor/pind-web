// Reading and writing a person's tags (A3, and Profile → Edit).
//
// One place, because both screens do exactly the same thing and the second one is
// where "replace what is there" gets subtly different if it is written twice.

import type { Picked } from "@/components/TagPicker";
import { supabase } from "./supabase";

export async function loadTags(personId: string): Promise<Picked[]> {
  const { data, error } = await supabase()
    .from("person_tags")
    .select("tag, on_list")
    .eq("person_id", personId);
  if (error) throw error;
  return (data ?? []).map((r) => ({ slug: r.tag, onList: r.on_list }));
}

// **Delete then insert, not a diff.** The picker's state is the whole answer, and a
// diff is three statements that can each half-succeed. The cap trigger is deferrable
// and checked per row, so removing everything first also means a person swapping
// their tenth tag never briefly holds eleven.
export async function saveTags(personId: string, picked: Picked[]): Promise<void> {
  const db = supabase();
  const { error: cleared } = await db.from("person_tags").delete().eq("person_id", personId);
  if (cleared) throw cleared;
  if (picked.length === 0) return;
  const { error } = await db
    .from("person_tags")
    .insert(picked.map((p) => ({ person_id: personId, tag: p.slug, on_list: p.onList })));
  if (error) throw error;
}
