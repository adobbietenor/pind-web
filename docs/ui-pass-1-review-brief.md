# Review brief: UI pass 1, group 2 (A9, A11, A15, A16, A20, A23, A28, A29)

For an **independent adversarial review**: a fresh Claude Code session with no prior
context, tasked only with finding leaks (decisions.md Part 5). **Flagged before real users
see it** (Alex, 30 Oct 2026: "flag the independent review before real users see it").
Group 2 changed who can see and do what in four places at once. Attack all four.

Alex agreed the rules in plain English before any of this was written: decisions.md, "UI
pass 1: the screen review and what it decided", and each migration's header. Your job:
- find any way a visitor, a signed-in person, or someone holding their own session token
  can read, infer, send or change what those rules say they must not;
- say whether the tests would catch it.

Report each leak with the rule it breaks and a concrete reproduction; a failing harness
case is best. **Do not fix anything**: fixes come afterwards as new migrations, each with
its case. Work against pind-staging only, never production.

## What to read, in order

1. **decisions.md**: "UI pass 1: the screen review and what it decided" (the calls), then
   H5, Q6 (superseded), Q7, V17 ("A bio is a V17 bypass") and the M3.4 1-on-1 rule.
2. **Migrations**, each headed by its rule:
   - `20261030171906_a16_how_was_it.sql`: E, "How was it?"
   - `20261030172534_a9_im_here_on_the_night.sql`: D, the night's "I'm here"
   - `20261030173358_a15_squad_details_place_time.sql`: C, a squad's words and place
   - `20261030174015_a28_one_on_one_switch_and_open_plan.sql` and
     `20261030174802_a28_solo_people_reads_the_switch.sql`: A, 1-on-1
   - `20261030175835_a16_keep_in_touch_request_and_accept.sql`: B, keep in touch
3. **Harness**: `tests/policies/ui-pass-1.test.ts` (P279–P297, one block per rule) and
   P278 in `policies.test.ts`.
4. **The name check** now judges a squad's whole card: `src/squad/check.ts`, `src/squad/ai.ts`.
5. **The app** only draws: `app/src/lib/{here,solo,after,squads,requests}.ts`.

## What to attack

- **D, "I'm here".** `arrivals` has RLS on and no grants; `here_now` is the only read. Can
  anyone outside a shared room or squad learn who is here or their line: through the count
  (`here_now` counts everyone; can a count of one plus a room's size name someone?), a
  women-only room, a squad they left, a block made after the arrival, or by racing
  `set_here` past the effective end? Does `set_here` write a squad arrival for a squad the
  person is not live in?
- **C, a squad's words.** Is any text a stranger reads ever listed before the exact card
  text passed the check (`squad_card_text`, `admin_record_squad_name_check`)? Edit, rename
  and the old `start_squad` (still there for installed builds): does each one put the card
  back to pending? Can a handle, phone number, link or email get past `has_contact` (spelled
  out, spaced, Unicode look-alikes, split across name, details and time)? Can a place ever
  be free text, or a spot of another venue? Can `edit_squad` be called by someone who left?
- **A, 1-on-1.** The switch is now on the account (`people_private.one_on_one`), read only by
  `private.solo_choice`; the old pin flag (`pins.solo_opt_in`) is kept as a narrower,
  per-gathering override for installed builds. Can that override widen anything, or keep
  someone visible after they switched the account off? Does every reader ask `solo_choice`
  (one did not, `solo_people`: fixed in `20261030174802`; look for others)? Does "Not now"
  ever reach the sender (`my_solo_proposals`, notifications, `my_solo_requests`)? Can
  `set_solo_place` be used by someone not in the chat, after the end, or to reveal a handle
  (`share_crew` now follows the place, including "at the event itself")?
- **B, keep in touch.** `keep_requests` has RLS on and no grants. Who can ask whom
  (`crossed_paths`: squad, 1-on-1, or both spoke in one room)? Can someone in a room of 30
  ask everyone (posting one message is cheap; is that the rule Alex agreed?) Does a
  declined request ever show as declined to its sender (`keep_people`, `my_keep_requests`,
  `my_connections`)? Can the 7-day window be crossed, a block bypassed, or a connection
  forged? Does `showed_up` now answer for anyone it should not?
- **E, "How was it?"** Can the old questions or the comment still be written by any path?

## Already proved (so look past them)

P278–P297, `check:after`, `check:pair` (two real sessions, silent "Not now"),
`check:link-path`, and the full harness, green on 30 Oct 2026.
