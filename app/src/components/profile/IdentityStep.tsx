// "A way to sign in" — Apple, Google or a six-digit email code. ONE step, drawn by A1
// (the store path: signing in) and A27 (the link path: the SAME anonymous user gains
// the identity, so the pin and the profile survive) (Alex, M3.2 walk: Apple and Google
// moved up — "the step where someone is most likely to give up").
//
// **No password field anywhere** (spec A1). Which methods appear is a platform fact
// (`methodsFor`, S15).
//
// **An identity that already has an account is the merge** (decisions, M3.2), for all
// three methods alike: nothing moves until that account's own sign-in proves it, then
// both sessions go to the Worker together; any failure puts the anonymous session back
// and says "Nothing was lost — your pin is still there".
//
// **The code step names the address it sent to** (Alex, M3.2 walk: autofill put a
// different address in the field, and nothing on screen said which).
import { useState } from "react";
import { Platform, View } from "react-native";
import { CODE_SENT_TO, codeLengthMismatch, EMAIL_CODE_LENGTH, isEmailTaken, OPTIN_COPY, spacing, WRONG_ADDRESS } from "@pind/shared";
import { SignInButton } from "@/components/SignInButton";
import { Body, Button, Field, Notice } from "@/components/ui";
import { linkEmail, linkProvider, methodsFor, sendEmailCode, signInError, signInForMerge, signInWithApple, signInWithGoogle, verifyEmailCode } from "@/lib/auth";
import { holdAnonymous, mergeHeld, stashForMerge, type Held, type Provider } from "@/lib/merge";
import { report } from "@/lib/sentry";
import { supabase } from "@/lib/supabase";

type Method = "apple" | "google" | "email";
const NAME: Record<Provider, string> = { apple: "Apple", google: "Google" };

export interface IdentityStepProps {
  mode: "sign-in" | "link";
  // The web path Apple and Google come back to.
  returnTo: string;
  onDone: (how: { method: Method; merged: boolean }) => void;
  // A27, back from Apple or Google: that identity already has an account.
  hasAccount?: Provider | null;
  // A sentence to start with (a merge that failed on the way back, say).
  notice?: string | null;
}

export function IdentityStep({ mode, returnTo, onDone, hasAccount = null, notice = null }: IdentityStepProps) {
  const methods = methodsFor();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(notice ?? "");
  const [info, setInfo] = useState("");
  // The anonymous session, held while the existing account proves itself (link mode).
  const [merging, setMerging] = useState<Held | null>(null);
  const [offer, setOffer] = useState<Provider | null>(hasAccount);
  const address = email.trim().toLowerCase();

  const attempt = async (what: string, run: () => Promise<void>) => {
    setBusy(what);
    setError("");
    try {
      await run();
    } catch (err) {
      // Which step failed decides the sentence: only entering a code can say a code
      // expired (S05–S07). A cancelled sheet says nothing at all.
      setError(signInError(what === "send" ? "send" : what === "verify" ? "verify" : "oauth", err));
    } finally {
      setBusy(null);
    }
  };

  // The merge, once the account's own sign-in has proved it. A failure has already put
  // the anonymous session back (lib/merge.ts); this says so.
  const merge = async (held: Held, method: Method) => {
    try {
      await mergeHeld(held);
      onDone({ method, merged: true });
    } catch (err) {
      report(err, "merge into the existing account");
      setMerging(null);
      setError(OPTIN_COPY.nothingLost);
    }
  };

  const provider = (p: Provider) =>
    attempt(p, async () => {
      if (mode === "sign-in") {
        if (Platform.OS === "web") {
          // The page goes to the provider and comes back to `returnTo`.
          await (p === "apple" ? signInWithApple : signInWithGoogle)(new URL(returnTo, window.location.origin).toString());
          return;
        }
        await (p === "apple" ? signInWithApple() : signInWithGoogle());
        onDone({ method: p, merged: false });
        return;
      }
      const linked = await linkProvider(p, returnTo);
      if (linked === "linked") onDone({ method: p, merged: false });
      if (linked === "has-account") setOffer(p);
    });

  // Bring the pin into the account that already owns this Apple or Google identity.
  const mergeWith = (p: Provider) =>
    attempt(p, async () => {
      const held = await holdAnonymous();
      if (!held) throw new Error("no anonymous session to bring in");
      if (Platform.OS === "web") {
        // The page leaves; A27 finishes the merge when it comes back (finishWebReturn).
        stashForMerge(held);
        await signInForMerge(p, returnTo);
        return;
      }
      await signInForMerge(p, returnTo);
      await merge(held, p);
    });

  const send = () =>
    attempt("send", async () => {
      if (mode === "sign-in") {
        await sendEmailCode(address);
        setSent(true);
        return;
      }
      try {
        await linkEmail(address);
        setSent(true);
      } catch (err) {
        if (!isEmailTaken(err)) throw err;
        // The address has an account: a sign-in code to it — never creating one — and
        // the anonymous session held until the code proves it.
        const held = await holdAnonymous();
        if (!held) throw err;
        const { error } = await supabase().auth.signInWithOtp({ email: address, options: { shouldCreateUser: false } });
        if (error) throw error;
        setMerging(held);
        setInfo(OPTIN_COPY.emailHasAccount);
        setSent(true);
      }
    });

  const verify = () =>
    attempt("verify", async () => {
      if (mode === "sign-in") {
        await verifyEmailCode(address, code);
        onDone({ method: "email", merged: false });
        return;
      }
      if (merging) {
        const { data, error } = await supabase().auth.verifyOtp({ email: address, token: code.trim(), type: "email" });
        if (error || !data.session) throw error ?? new Error("no session");
        await merge(merging, "email");
        return;
      }
      const { error } = await supabase().auth.verifyOtp({ email: address, token: code.trim(), type: "email_change" });
      if (error) throw error;
      onDone({ method: "email", merged: false });
    });

  return (
    <>
      {error ? <Notice tone="stop">{error}</Notice> : null}

      {offer ? (
        <View style={{ marginBottom: spacing.lg, gap: spacing.sm }}>
          <Body>{`That ${NAME[offer]} account already has a Pin'd account. Continue with ${NAME[offer]} to bring this pin into it.`}</Body>
          <SignInButton provider={offer} busy={busy === offer} onPress={() => mergeWith(offer)} />
          <Button kind="quiet" label="Use something else" onPress={() => setOffer(null)} />
        </View>
      ) : (
        <>
          {methods.includes("apple") ? (
            <View style={{ marginBottom: spacing.sm }}>
              <SignInButton provider="apple" busy={busy === "apple"} onPress={() => provider("apple")} />
            </View>
          ) : null}
          {methods.includes("google") ? (
            <View style={{ marginBottom: spacing.sm }}>
              <SignInButton provider="google" busy={busy === "google"} onPress={() => provider("google")} />
            </View>
          ) : null}

          <View style={{ alignItems: "center", marginVertical: spacing.md }}>
            <Body muted>or</Body>
          </View>

          {!sent ? (
            <>
              <Field
                label="Email me a code"
                placeholder="you@example.com"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                value={email}
                onChangeText={setEmail}
              />
              <Button label="Send the code" busy={busy === "send"} disabled={!/^\S+@\S+\.\S+$/.test(address)} onPress={send} />
            </>
          ) : (
            <>
              {info ? (
                <View style={{ marginBottom: spacing.sm }}>
                  <Body>{info}</Body>
                </View>
              ) : null}
              <Field
                label={CODE_SENT_TO(address)}
                placeholder={"1".repeat(EMAIL_CODE_LENGTH)}
                autoComplete="one-time-code"
                keyboardType="number-pad"
                inputMode="numeric"
                // Deliberately longer than the code (M3.1): a pasted 8-digit code must be
                // let in and then told what is wrong with it, not silently cut.
                maxLength={12}
                value={code}
                onChangeText={(text) => setCode(text.replace(/\D/g, ""))}
                hint={`${EMAIL_CODE_LENGTH} digits. It expires in an hour.`}
                error={code.length > EMAIL_CODE_LENGTH ? codeLengthMismatch(code.length) : undefined}
              />
              <Button label="Continue" busy={busy === "verify"} disabled={code.length !== EMAIL_CODE_LENGTH} onPress={verify} />
              <View style={{ marginTop: spacing.sm }}>
                <Button
                  kind="quiet"
                  label={WRONG_ADDRESS}
                  onPress={() => {
                    setSent(false);
                    setCode("");
                    setError("");
                    setInfo("");
                    setMerging(null);
                  }}
                />
              </View>
            </>
          )}
        </>
      )}

      <View style={{ marginTop: spacing.lg }}>
        <Body muted>No password, ever. We will not post anything or read your contacts.</Body>
      </View>
    </>
  );
}
