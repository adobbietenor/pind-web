// M3.2b — interests, remembered (Alex, M3.1; decided 10 Oct 2026). The list chips a
// person chose, kept on their account so A6/A7 opens already narrowed to them. Not the
// tags: nothing but the list reads these, and nobody but the person can (P188–P190).
// The rules — which apply, which rest, what a tap remembers — are in
// packages/shared/src/search.ts, where tests reach them.
//
// No person, nothing remembered: someone who has never pinned has no account, and the
// chips work for them as they always have.
import { supabase } from "./supabase";
import { whoAmI } from "./session";

// The person signed in NOW, read at the point of use (CLAUDE.md: re-read who you are).
async function personNow(): Promise<string | null> {
  const read = await whoAmI();
  if (read.state !== "in") return null;
  const { data, error } = await supabase().from("people").select("id").eq("auth_user_id", read.userId).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

// The remembered categories — or null when there is nobody to remember for, so the
// screen never says "your interests" to someone it cannot keep them for.
export async function readInterests(): Promise<string[] | null> {
  const person = await personNow();
  if (!person) return null;
  const { data, error } = await supabase().from("person_interests").select("categories").eq("person_id", person).maybeSingle();
  if (error) throw error;
  return (data?.categories as string[] | undefined) ?? [];
}

// Remember exactly this set; empty clears it. Without a person, nothing to remember.
export async function saveInterests(categories: string[]): Promise<void> {
  const person = await personNow();
  if (!person) return;
  const db = supabase();
  if (categories.length === 0) {
    const { error } = await db.from("person_interests").delete().eq("person_id", person);
    if (error) throw error;
    return;
  }
  // Change the row, or make it the first time. Not an upsert: its conflict path rewrites
  // person_id, which nobody is granted to change.
  const changed = await db.from("person_interests").update({ categories: categories as never }).eq("person_id", person).select("person_id");
  if (changed.error) throw changed.error;
  if (changed.data.length) return;
  const { error } = await db.from("person_interests").insert({ person_id: person, categories: categories as never });
  if (error) throw error;
}
