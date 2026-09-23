# Configured by hand — none of this is visible from the repo

Every value here was set in a dashboard or a console, for **pind-staging** and its
Apple, Google, Resend and EAS counterparts. It moved here from `docs/m3.1-resume.md`
when M3.1 merged, because **M4.3 has to rebuild all of it for production** and nothing
in the repo would otherwise say what it is.

**When one is in dispute, read it from what
enforces it, not what displays it**: `npx supabase config diff` (read-only) shows the
hosted auth config; the auth server's own error codes show what it enforces. **Never
`npx supabase config push`** — `config.toml` is the init template and would overwrite
all of this.

## Supabase Auth (pind-staging, `mxuajvlrkggrqpntekqt`)

| Setting | Value | Must match / note |
|---|---|---|
| Site URL | `https://pind.social` | |
| Redirect URLs | `https://pind.social/**` · `pind-staging://**` · `http://localhost:8081/**` · `pind://**` | the app's `scheme` in `app/app.config.ts` |
| Anonymous sign-ins | on | |
| **Allow manual linking** | **on — confirmed by `config diff` (hosted `true`) and P86** | Needed for `linkIdentity` (A27). It showed on in the dashboard while the stored config was off; it took an off-on-**Save**. `config.toml` still says `false`, deliberately untouched |
| **Email OTP length** | **6** | `EMAIL_CODE_LENGTH` in `packages/shared/src/constants.ts`. Not testable from the repo — check by eye if it ever changes |
| **Custom SMTP** | Resend, `smtp.resend.com`, sender **auth@pind.social**, its **own** Resend key `supabase-auth` | required: templates cannot be edited without it |
| Email templates (**read from the server**, not the dashboard) | **Every template that can sign someone in sends a code**: Confirm signup, Magic Link, Change Email Address, Reset Password and Invite user — body `{{ .Token }}` with no ConfirmationURL, TokenHash or SiteURL. Subject **"Your Pin'd Code"** on all six, Reauthentication included (Alex: settled, do not change). The seven security notifications are off | Three separate links came from templates nobody had thought of (the last: Confirm signup, for a new address, 2026-09-23). Subjects were confirmed by `config diff`; **bodies are not readable from the CLI**, so a body is proved by what arrives — a code to a brand-new address (Confirm signup) arrived as six digits on 2026-09-23. To re-read the subjects: a scratch copy of `config.toml` that declares every template, then `supabase config diff --workdir <scratch>` (read-only) |
| SMS provider dropdown | shows Twilio | **nobody set it** — the default in an unused dropdown; the phone method is off (`phone: false`) |
| Custom auth domain | **not set up** | M4.3 — **the only fix** for Google's "continue to …supabase.co"; $10/month per project on top of Pro |

## Google

- OAuth client in the Google Cloud project **PIND**; authorised redirect URI, exactly:
  `https://mxuajvlrkggrqpntekqt.supabase.co/auth/v1/callback`.
- **Consent screen:** app name "Pin'd"; **Authorised domain changed from the supabase.co
  host to `pind.social`** (M3.1) and kept there — it is the more correct value. **It did
  not change the sentence**: the picker still says "Sign in to continue to
  mxuajvlrkggrqpntekqt.supabase.co", tested well after Google's cache. The free route
  does not work; only the custom auth domain (M4.3) fixes it — recorded in build-plan
  §8, M4.3.
- **In Testing**, so only listed test users can sign in. **Moving it to In production is
  an M3.2 step** — and **no logo on it, ever, unless we choose to be reviewed**.

## Apple

- **Sign in with Apple** on App ID `social.pind.app.staging`.
- **Services ID `social.pind.web`**, domains `pind.social` and
  `mxuajvlrkggrqpntekqt.supabase.co`, return URL the Supabase callback. **Its primary
  App ID is the staging one** — re-pointing it is M4.3.
- A Sign in with Apple key; the `.p8` lives outside the repo.
- Supabase's secret is a **JWT minted from the `.p8`** (`scripts/apple-client-secret.ts`),
  **expiring 2027-03-23** — `APPLE_SECRET_EXPIRES` in `wrangler.jsonc`, shown in the
  admin, alerted from six weeks out by the 09:00 run. When it lapses, **web** Apple
  sign-in breaks and native keeps working.

## Supabase Vault and the Worker

- Vault: `photo_check_url` = `https://pind.social/hooks/photo-check`, and
  `photo_check_secret` (stored with whitespace round it; both sides trim; the admin
  says it is there). Worker secret `PHOTO_WEBHOOK_SECRET`, the same value.
- Worker crons: `0 8 * * *` import, **`0 * * * *` photo sweep** (credential watch on its
  09:00 run), `0 13 * * *` liveness — routed by `src/cron.ts`.

## EAS

- The `development` and `internal` environments carry the four public keys (Supabase
  URL and publishable key, PostHog, Sentry). Device `00008130-000969E90EE2001C` is
  registered.

## Resend / DNS

- Domain `pind.social`; DKIM aligned; **DMARC `p=none`** — Alex is adding
  `rua=mailto:dmarc@pind.social`, then `p=quarantine` after a week.
