// Reading and writing your own profile (A21), and the two things A23 does with it.
//
// **Everything here reads as the signed-in person.** The service key never appears in
// the app, and the app is never the thing that decides who sees what — RLS is (H11).
// So "what others see" on the preview is not a re-implementation of the rules: it is
// the same columns the same policies would hand someone else, described honestly.

import { readSession, Said } from "@pind/shared";
import { SessionProblem, whoAmI } from "./session";
import { supabase } from "./supabase";

const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://pind.social";

export interface Me {
  id: string;
  firstName: string;
  lastInitial: string | null;
  neighbourhood: string | null;
  photoPath: string | null;
  photoStatus: "pending" | "approved" | "needs_review" | "rejected";
  instagram: string | null;
  tags: string[];
  gatherings: number;
  // Crews met, and the "showed up" badge, both need a mutual we-met (A16, M3.3).
  // Until crews exist these are honestly zero rather than hidden.
  crewsMet: number;
  showedUp: boolean;
}

// **`null` means one thing: signed in on no device, or signed in with no profile yet.**
// Anything that failed to arrive THROWS, so the Profile tab cannot read "offline" as
// "Nothing here yet — set up your profile" (the airplane-mode walk, M3.1).
export async function loadMe(): Promise<Me | null> {
  const db = supabase();
  const read = await whoAmI();
  if (read.state === "out") return null;
  if (read.state !== "in") throw new SessionProblem(read);

  const { data: person, error: personError } = await db
    .from("people")
    .select("id, first_name, last_initial, neighbourhood, photo_path, photo_status")
    .eq("auth_user_id", read.userId)
    .maybeSingle();
  if (personError) throw personError;
  if (!person) return null;

  const [handle, tags, pins, crews] = await Promise.all([
    db.from("person_handles").select("instagram").eq("person_id", person.id).maybeSingle(),
    db.from("person_tags").select("tag").eq("person_id", person.id),
    db.from("pins").select("id").eq("person_id", person.id),
    db.from("crew_members").select("id").eq("person_id", person.id).is("left_at", null),
  ]);

  return {
    id: person.id,
    firstName: person.first_name,
    lastInitial: person.last_initial,
    neighbourhood: person.neighbourhood,
    photoPath: person.photo_path,
    photoStatus: person.photo_status,
    instagram: handle.data?.instagram ?? null,
    tags: (tags.data ?? []).map((t) => t.tag),
    gatherings: pins.data?.length ?? 0,
    crewsMet: crews.data?.length ?? 0,
    showedUp: false,
  };
}

// The owner can always read their own photo, whatever its status (V6), so this works
// while a photo is pending or under review — which is the point: they should see the
// picture they uploaded while being told nobody else can yet.
export async function photoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase().storage.from("photos").createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

// The handle is optional, never required, and never a substitute for the photo
// (decisions Part 4). Removing it deletes the row rather than storing an empty string.
export async function saveInstagram(personId: string, handle: string): Promise<void> {
  const db = supabase();
  const value = handle.trim().replace(/^@/, "");
  if (!value) {
    const { error } = await db.from("person_handles").delete().eq("person_id", personId);
    if (error) throw error;
    return;
  }
  if (!/^[A-Za-z0-9._]{1,30}$/.test(value)) {
    throw new Said("An Instagram handle is letters, numbers, dots and underscores.");
  }
  // **Not an upsert**, for the same reason as `people_private` (A2): `person_handles`
  // grants INSERT on both columns and UPDATE on `instagram` alone, so an
  // `ON CONFLICT DO UPDATE` that also sets `person_id` is refused outright — before
  // Postgres knows whether the row exists. Two statements, and the one that runs is
  // the one the grants allow.
  const { data: existing } = await db
    .from("person_handles")
    .select("person_id")
    .eq("person_id", personId)
    .maybeSingle();
  const { error } = existing
    ? await db.from("person_handles").update({ instagram: value }).eq("person_id", personId)
    : await db.from("person_handles").insert({ person_id: personId, instagram: value });
  if (error) throw error;
}

// **Read as you, through RLS** (Alex, M3.1), so it cannot over-return: every table
// below hands back exactly what the policies would hand you and nothing else. The
// reports are the ones you filed — your reason and the date, never the moderation
// outcome, which is not yours.
export async function exportMyData(): Promise<Record<string, unknown>> {
  const db = supabase();
  const read = await whoAmI();
  if (read.state !== "in") throw new SessionProblem(read);
  const { data: person, error: personError } = await db
    .from("people")
    .select("*")
    .eq("auth_user_id", read.userId)
    .maybeSingle();
  if (personError) throw personError;
  if (!person) throw new Said("There is nothing here to export yet.");

  const [priv, handle, tags, pins, contacts, votes, surveys, blocks, crews, messages, reports] = await Promise.all([
    db.from("people_private").select("*").eq("person_id", person.id),
    db.from("person_handles").select("instagram, created_at").eq("person_id", person.id),
    db.from("person_tags").select("tag").eq("person_id", person.id),
    db.from("pins").select("*").eq("person_id", person.id),
    db.from("contact_points").select("kind, value, created_at").eq("person_id", person.id),
    db.from("spot_votes").select("*").eq("person_id", person.id),
    db.from("survey_responses").select("*").eq("person_id", person.id),
    db.from("blocks").select("blocked_id, created_at").eq("blocker_id", person.id),
    db.from("crew_members").select("*").eq("person_id", person.id),
    db.from("crew_messages").select("crew_id, body, created_at").eq("author_id", person.id),
    db.from("reports").select("id, target_kind, reason, created_at"),
  ]);

  return {
    exported_at: new Date().toISOString(),
    what_this_is:
      "Everything Pin'd holds about you, read with your own account so it shows exactly what you can see. " +
      "Your gender, birth year and 19+ attestation are in people_private and are visible to nobody but you. " +
      "Reports are the ones you filed: your reason and the date, not the moderation decision.",
    person,
    private: priv.data,
    instagram: handle.data,
    tags: (tags.data ?? []).map((t) => t.tag),
    pins: pins.data,
    contact_points: contacts.data,
    spot_votes: votes.data,
    survey_responses: surveys.data,
    blocks_i_made: blocks.data,
    crew_memberships: crews.data,
    messages_i_wrote: messages.data,
    reports_i_filed: reports.data,
  };
}

// **One server-side call, not the app doing the parts it can.** Removing the auth
// user needs the service key; a half-finished delete leaves either a session that
// signs in to nothing or a profile nobody can reach.
export async function deleteAccount(): Promise<void> {
  const db = supabase();
  const { data, error } = await db.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    const read = readSession(data.session, error);
    throw new SessionProblem(read.state === "in" ? { state: "out" } : read);
  }
  const response = await fetch(`${SITE}/account/delete`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  // The Worker's own message can carry a database error; it goes to Sentry through
  // `describe`, and the person reads "something went wrong on our side".
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw Object.assign(new Error(body.error ?? `account delete ${response.status}`), { status: response.status });
  }
  await db.auth.signOut();
}

// ---------------------------------------------------------------------------
// **The one place a profile is written** (Alex, M3.2 walk). A2 and A27 each wrote their
// own date of birth, gender and photo, and the women-only question had already drifted
// between them. The shared steps (components/profile) call these; S27 fails if any
// screen writes `people_private`, a photo path, a neighbourhood or tags itself.
// ---------------------------------------------------------------------------

export interface ProfileNow {
  personId: string | null;
  firstName: string;
  permanent: boolean;
  hasPrivate: boolean;
  hasPhoto: boolean;
  neighbourhood: string | null;
  tagCount: number;
}

// Where this person's profile stands, read fresh as whoever is signed in NOW (CLAUDE.md:
// re-read who you are after anything that can change it). No person yet is a profile
// with nothing in it, not an error.
export async function readProfile(): Promise<ProfileNow> {
  const db = supabase();
  const read = await whoAmI();
  if (read.state !== "in") throw new SessionProblem(read);
  const { data: person, error } = await db
    .from("people")
    .select("id, first_name, photo_path, neighbourhood")
    .eq("auth_user_id", read.userId)
    .maybeSingle();
  if (error) throw error;
  const { data: session } = await db.auth.getSession();
  const permanent = !!session.session && !session.session.user.is_anonymous;
  if (!person) return { personId: null, firstName: "", permanent, hasPrivate: false, hasPhoto: false, neighbourhood: null, tagCount: 0 };
  const [priv, tags] = await Promise.all([
    db.from("people_private").select("person_id").eq("person_id", person.id).maybeSingle(),
    db.from("person_tags").select("tag").eq("person_id", person.id),
  ]);
  if (priv.error) throw priv.error;
  if (tags.error) throw tags.error;
  return {
    personId: person.id,
    firstName: person.first_name,
    permanent,
    hasPrivate: !!priv.data,
    hasPhoto: !!person.photo_path,
    neighbourhood: person.neighbourhood,
    tagCount: tags.data?.length ?? 0,
  };
}

export interface YouAnswers {
  firstName: string;
  // Only written when the person has no date of birth and gender yet: the birth year is
  // asked once and is not editable (people_private grants UPDATE on gender and
  // include_in_women_only alone).
  birthYear: number | null;
  gender: "woman" | "man" | "nonbinary" | "undisclosed" | null;
  // Asked of nonbinary people only (the constraint says so too); anyone else is false.
  womenOnly: boolean;
  // A path already uploaded to the person's own folder, or null to leave the photo alone.
  photoPath: string | null;
}

// "You": the person row (made here on the store path; already there from the pin on the
// link path), then date of birth and gender. Returns the person's id.
export async function saveYou(a: YouAnswers): Promise<string> {
  const db = supabase();
  const read = await whoAmI();
  if (read.state !== "in") throw new SessionProblem(read);

  // Insert or update, never upsert: `auth_user_id` is insert-only, so an upsert would
  // ask for a privilege the person does not have.
  const { data: mine, error: mineError } = await db.from("people").select("id").eq("auth_user_id", read.userId).maybeSingle();
  if (mineError) throw mineError;
  let personId = mine?.id ?? null;
  if (personId) {
    const { error } = await db
      .from("people")
      .update({ first_name: a.firstName.trim(), ...(a.photoPath ? { photo_path: a.photoPath } : {}) })
      .eq("id", personId);
    if (error) throw error;
  } else {
    const { data: made, error } = await db
      .from("people")
      .insert({ auth_user_id: read.userId, first_name: a.firstName.trim(), photo_path: a.photoPath })
      .select("id")
      .single();
    if (error) throw error;
    personId = made.id as string;
  }

  if (a.gender) {
    // **Never an upsert here, and this cost a walk** (M3.1): an upsert is checked for
    // UPDATE privileges on every column statically, and `birth_year` has none — so the
    // first insert of a brand-new person was refused for an update that would never run.
    const womenOnly = a.gender === "nonbinary" ? a.womenOnly : false;
    const { data: priv, error: privError } = await db.from("people_private").select("person_id").eq("person_id", personId).maybeSingle();
    if (privError) throw privError;
    const { error } = priv
      ? await db.from("people_private").update({ gender: a.gender, include_in_women_only: womenOnly }).eq("person_id", personId)
      : await db.from("people_private").insert({
          person_id: personId,
          gender: a.gender,
          include_in_women_only: womenOnly,
          birth_year: a.birthYear,
          age_attested_at: new Date().toISOString(),
        });
    if (error) throw error;
  }
  return personId;
}

// The photo alone (Profile → Change photo): a new path sends it back to the check (V6),
// null removes it.
export async function setPhotoPath(personId: string, path: string | null): Promise<void> {
  const { error } = await supabase().from("people").update({ photo_path: path }).eq("id", personId);
  if (error) throw error;
}

// The neighbourhood — A3, A27's "where", and Profile → Neighbourhood. Null clears it.
export async function saveNeighbourhood(personId: string, slug: string | null): Promise<void> {
  const { error } = await supabase().from("people").update({ neighbourhood: slug }).eq("id", personId);
  if (error) throw error;
}
