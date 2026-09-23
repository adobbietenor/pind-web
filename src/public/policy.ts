// The privacy policy and terms — DRAFTS (Alex, M3.2).
//
// Built early because publishing the Google consent screen required a privacy-policy
// URL and a terms URL, and Google accepted both without fetching them: the consent
// screen linked to two pages that did not exist. They live at exactly /privacy and
// /terms, in `run_worker_first` (a missing route would serve the app with a 200).
//
// **Every place-of-data statement was read, not inferred** (decisions, "Where the data
// is"): Supabase in ca-central-1 (Montreal) from the Management API; Resend us-east-1
// from its dashboard; Sentry's US region from the DSN; PostHog US by choice; Anthropic
// US, pinned per request (`inference_geo: "us"`, confirmed live). A policy naming the
// wrong country is worse than a vague one.
//
// **Each legal statement says which fact it rests on** (Alex): the company is in Surrey,
// British Columbia; the product is used in Toronto, Ontario. M4.1's lawyer hour
// replaces this text; POLICY_VERSION is what A27 stores as accepted.

import { CREWS_MEET, HOUSE_RULES, POLICY_DRAFT_NOTICE, POLICY_VERSION, PRIVACY_CONTACT, THRESHOLD } from "@pind/shared";
import { DOT, escape, header, page } from "./layout";

const OPERATOR = "Tenor Investments Inc.";
const ADDRESS = "2562 136th Street, Surrey, BC V4P 1S4, Canada";
const SAFETY = "safety@pind.social";

function draftBanner(): string {
  return `<p class="notice"><strong>Draft — not reviewed by a lawyer.</strong> ${escape(POLICY_DRAFT_NOTICE)} Version <code>${escape(POLICY_VERSION)}</code>.</p>`;
}

const FOOTER = `<a href="/">this week&#39;s crowds</a>${DOT}<a href="/privacy">privacy</a>${DOT}<a href="/terms">terms</a>${DOT}19+`;

export function privacy(): Response {
  return page(
    `${header()}
<h1>Privacy policy</h1>
${draftBanner()}

<h2>Who we are</h2>
<p>Pin&#39;d is operated by ${OPERATOR}, ${ADDRESS}. Our Privacy Officer is Alex Dobbie, reachable at <a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>. Anything about your personal information — a question, a request, a complaint — goes there, and a person reads it.</p>

<h2>Which privacy laws apply, and why</h2>
<p><strong>Because Pin&#39;d is used in Toronto, Ontario</strong>, and Ontario has no private-sector privacy law of its own, the federal <em>Personal Information Protection and Electronic Documents Act</em> (PIPEDA) governs the personal information we collect from people there, and any that moves between provinces.</p>
<p><strong>Because ${OPERATOR} is based in Surrey, British Columbia</strong>, British Columbia&#39;s <em>Personal Information Protection Act</em> (PIPA) applies to how we handle personal information within British Columbia, including anyone in British Columbia who uses Pin&#39;d.</p>
<p>We follow the stricter of the two wherever they differ.</p>

<h2>What we collect, and when</h2>
<p><strong>When you pin in</strong> (no account needed): your first name, who is coming with you (just you, or how many), whether you would like to meet other people going, and that you ticked &ldquo;I&#39;m 19 or older&rdquo;. We create an anonymous account for you so that your pin is yours and only you can change it.</p>
<p><strong>If you choose to meet people</strong>, we also ask for:</p>
<ul>
<li><strong>Your date of birth.</strong> We use it once to check you are 19 or older, keep only the year, and throw the rest away.</li>
<li><strong>Your gender</strong> (woman, man, nonbinary, or prefer not to say). We ask it once, for one purpose: women-only crews, and a count of the mix of people going that is shown only once five or more people have opted in. It never appears on any profile, including your own, and nobody else can ever read yours.</li>
<li><strong>A photo</strong>, so the people you meet can find you.</li>
<li><strong>A way to sign in</strong>: your email address (we send you a six-digit code — there are no passwords), or Sign in with Apple, or Google.</li>
<li><strong>Optionally</strong>: a neighbourhood, a few tags about yourself, and an Instagram handle.</li>
</ul>
<p>When you use crews, we keep the crew&#39;s messages, and the reports and blocks you make.</p>
<p><strong>What we never collect:</strong> your location, your contacts, your phone number, your surname beyond an initial, your ticket or seat, advertising identifiers, or anything about your employer, school or sexual orientation. Pin&#39;d never asks where you are; the only coordinates we hold belong to venues and the public spots crews meet at.</p>

<h2>Who can see what</h2>
<ul>
<li>Anyone can see <strong>how many</strong> people have pinned in to a gathering and how many would like to meet. Never who.</li>
<li>Your first name and photo are seen <strong>only by people who have also pinned in to the same gathering and also said they would like to meet</strong> — and never by anyone you have blocked, or who has blocked you.</li>
<li>Your Instagram handle, if you add one, is seen only by your crewmates, a 1-on-1 partner and your connections. Never on the open list, never on a public page.</li>
<li>Your gender, birth year and email address are seen by nobody but you (and the few people who operate Pin&#39;d, when they must).</li>
</ul>

<h2>The automated photo check</h2>
<p>Every photo is checked automatically when you upload it, by Anthropic&#39;s AI service. It looks only for things that are not allowed — nudity, hate imagery, violence — and for anyone who may be under 19. Your photo shows as soon as you add it; the check can only take it down. If it is rejected, <strong>the image is deleted at once</strong>, you are told, and you can add another. We keep a record that the check happened, and its result, for 12 months. If the check thinks someone may be under 19, a person at Pin&#39;d looks at it; that is never shown to you or anyone else as a verdict about you.</p>

<h2>Where your information is kept and processed</h2>
<p>Your profile, pins, photos and messages are stored by <strong>Supabase</strong>, in its <strong>Montreal, Canada</strong> region. Some services we use process information outside Canada, in the <strong>United States</strong>, where it may be accessible to authorities there under US law:</p>
<ul>
<li><strong>Anthropic</strong> — receives your photo to check it, processed and stored in the US.</li>
<li><strong>Resend</strong> — sends your sign-in codes and our emails, in the US (North Virginia).</li>
<li><strong>PostHog</strong> — counts which steps people take (for example, &ldquo;opened the page&rdquo;, &ldquo;pinned in&rdquo;), in the US. It is sent without your IP address and without any location, and never with your name, email or photo.</li>
<li><strong>Sentry</strong> — receives crash and error reports so we can fix what broke, in the US, without your name or email.</li>
<li><strong>Cloudflare</strong> — delivers pind.social&#39;s pages from its worldwide network, from whichever location is nearest to you.</li>
<li><strong>Apple</strong> or <strong>Google</strong> — only if you choose to sign in with them.</li>
</ul>

<h2>Gatherings from Ticketmaster</h2>
<p>Some gatherings come from Ticketmaster&#39;s public event listings. We keep only the facts of the event — its name, time and venue — never Ticketmaster&#39;s images or descriptions, and we delete that data 30 days after the event. We make no money from it.</p>

<h2>How long we keep things</h2>
<ul>
<li><strong>Pins</strong> — deleted 30 days after the gathering. We keep only the totals (how many went), with nobody&#39;s name.</li>
<li><strong>If you pinned in but never opted in</strong>, your anonymous account is deleted with your last pin, 30 days after the gathering.</li>
<li><strong>Crew messages</strong> — read-only 24 hours after the gathering, deleted 30 days after it.</li>
<li><strong>Your date of birth</strong> — only the year is ever kept.</li>
<li><strong>A rejected photo</strong> — deleted at once; the record of the check, 12 months.</li>
<li><strong>Reports and moderation decisions</strong> — 12 months, including the message a report was about.</li>
<li><strong>Your profile</strong> — until you delete your account.</li>
</ul>
<p>&ldquo;After the gathering&rdquo; means after its end time, or three hours after it starts when there is no end time.</p>

<h2>Your rights</h2>
<p><strong>Under both PIPEDA and PIPA</strong> you can ask what personal information we hold about you, ask us to correct it, and withdraw your consent. We answer within 30 days.</p>
<ul>
<li><strong>See it:</strong> Profile → Safety &amp; settings → <em>Export my data</em> gives you everything we hold about you, as a file, at once.</li>
<li><strong>Delete it:</strong> Profile → Safety &amp; settings → <em>Delete my account</em>. Your account, profile, photo, pins and everything tied to them go. Two things stay: reports made by or about you (for 12 months, with your name removed), and your lines in a crew&#39;s conversation, shown as &ldquo;someone who left&rdquo;, so other people&#39;s conversation is not rewritten.</li>
<li><strong>Anything else</strong>, or if you cannot use the app: <a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>.</li>
</ul>
<p>If you are not satisfied with our answer, you can complain to the <strong>Office of the Privacy Commissioner of Canada</strong> (federal, PIPEDA) or, in British Columbia, the <strong>Office of the Information and Privacy Commissioner for British Columbia</strong> (PIPA).</p>

<h2>Changes</h2>
<p>This is a draft. When it is replaced we will say so in the app and ask you to accept the new version before you carry on.</p>`,
    { title: "Privacy · Pin'd", description: "How Pin'd handles your personal information.", footer: FOOTER },
  );
}

export function terms(): Response {
  return page(
    `${header()}
<h1>Terms</h1>
${draftBanner()}

<h2>Who you are agreeing with</h2>
<p>Pin&#39;d is operated by ${OPERATOR}, ${ADDRESS}. By pinning in or making an account you agree to these terms and to our <a href="/privacy">privacy policy</a>.</p>

<h2>Who can use Pin&#39;d</h2>
<p>You must be <strong>19 or older</strong>. You must use your own first name and a photo of you.</p>

<h2>What Pin&#39;d is, and what it is not</h2>
<p>Pin&#39;d helps people who are already going to the same event find each other beforehand. Once ${THRESHOLD} people who would like to meet have pinned in, small crews can form and meet at a public spot near the venue before the event.</p>
<p><strong>We organise nothing.</strong> We do not run, host or attend the events or the meetups, we do not check who people are beyond what these terms ask, and we are not responsible for what happens when people meet. You decide whether to meet anyone, and you can leave a crew at any time. Meet in public, tell someone where you are going, and trust your judgement.</p>

<h2>House rules</h2>
<ol class="rules">${HOUSE_RULES.map((r) => `<li>${escape(r)}</li>`).join("")}</ol>
<p class="crews-meet">${escape(CREWS_MEET)}</p>
<p>Block and report are always one tap away. We may hide or remove anyone who breaks these rules, and remove content without notice. Anything about safety goes to <a href="mailto:${SAFETY}">${SAFETY}</a>, and a person reads it.</p>

<h2>Your content</h2>
<p>Your name, photo, tags and messages stay yours. You let us show them to the people these terms and the privacy policy say can see them, for as long as they are on Pin&#39;d.</p>

<h2>Liability</h2>
<p>Pin&#39;d is provided as it is, free of charge. To the extent the law allows, ${OPERATOR} is not liable for losses arising from events, meetups or other people&#39;s conduct.</p>

<h2>Law</h2>
<p><strong>Because ${OPERATOR} is based in British Columbia</strong>, these terms are governed by the laws of British Columbia and the federal laws of Canada that apply there.</p>

<h2>Changes</h2>
<p>This is a draft. When it is replaced we will say so in the app and ask you to accept the new version before you carry on.</p>`,
    { title: "Terms · Pin'd", description: "The terms for using Pin'd.", footer: FOOTER },
  );
}
