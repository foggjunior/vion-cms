'use client';

import { useState, type FormEvent } from 'react';
import { FirebaseError } from 'firebase/app';
import {
  getMultiFactorResolver, inMemoryPersistence, multiFactor, setPersistence,
  signInWithEmailAndPassword, signOut, TotpMultiFactorGenerator,
  type Auth, type MultiFactorError, type MultiFactorResolver, type TotpSecret, type User,
} from 'firebase/auth';
import { firebaseAuth } from '../../lib/firebase-client';

type Step =
  | { kind: 'credentials' }
  | { kind: 'challenge'; resolver: MultiFactorResolver; setUp: boolean }
  | { kind: 'setup'; user: User; secret: TotpSecret };

const signInError = 'Unable to sign in. Check your details or contact your CMS administrator.';
const buttonStyle = 'w-full rounded-xl bg-[#aa791b] py-3 font-bold text-white disabled:opacity-60';
const errorCode = (error: unknown) => error instanceof FirebaseError ? error.code : '';
const knownMessage = (error: unknown) =>
  error instanceof Error && !(error instanceof FirebaseError) ? error.message : signInError;
const totpFactors = (resolver: MultiFactorResolver) =>
  resolver.hints.filter(factor => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID);
const clearFirebaseSignIn = (auth: Auth) => signOut(auth).catch(() => undefined);

async function createStaffSession(user: User) {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: await user.getIdToken() }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.code === 'mfa-required'
      ? 'Your role requires an authenticator. Contact your CMS administrator for help restoring access.'
      : signInError);
  }
}

function CodeField({ label }: { label: string }) {
  return (
    <label className="block text-sm font-bold">
      {label}
      <input required autoFocus type="text" name="code" inputMode="numeric" autoComplete="one-time-code"
        pattern="[0-9]{6}" maxLength={6} className="mt-2" />
    </label>
  );
}

export default function Login() {
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function finishSignIn(user: User, setUp: boolean) {
    // Use the same staff and MFA checks as a normal login before opening setup.
    if (setUp && !user.emailVerified) {
      throw new Error('Verify your Firebase account email before setting up an authenticator. Contact your administrator for help.');
    }
    await createStaffSession(user);
    if (!setUp) {
      await clearFirebaseSignIn(firebaseAuth());
      window.location.assign('/workspace');
      return;
    }

    // Complete setup with a recent, in-memory Firebase login and no CMS session.
    const signedOut = await fetch('/api/auth/session', { method: 'DELETE' });
    if (!signedOut.ok) throw new Error('Unable to start authenticator setup. Please try signing in again.');
    try {
      const session = await multiFactor(user).getSession();
      const secret = await TotpMultiFactorGenerator.generateSecret(session);
      setStep({ kind: 'setup', user, secret });
    } catch {
      throw new Error('Unable to start authenticator setup. Ask your administrator to check the Firebase configuration.');
    }
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    let auth: Auth | undefined;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      auth = firebaseAuth();
      await setPersistence(auth, inMemoryPersistence);
      const setUp = data.has('setup');
      let user: User;
      try {
        ({ user } = await signInWithEmailAndPassword(auth, String(data.get('email')), String(data.get('password'))));
      } catch (failure) {
        if (errorCode(failure) !== 'auth/multi-factor-auth-required') throw new Error(signInError);
        const resolver = getMultiFactorResolver(auth, failure as MultiFactorError);
        if (!totpFactors(resolver).length) {
          throw new Error('This account has no supported authenticator. Contact your CMS administrator.');
        }
        setStep({ kind: 'challenge', resolver, setUp });
        return;
      }
      await finishSignIn(user, setUp);
    } catch (failure) {
      if (auth) await clearFirebaseSignIn(auth);
      setError(knownMessage(failure));
    } finally {
      const password = form.elements.namedItem('password') as HTMLInputElement;
      password.value = '';
      setBusy(false);
    }
  }

  async function submitChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || step.kind !== 'challenge') return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const factor = totpFactors(step.resolver).find(item => item.uid === data.get('factor'));
    if (!factor) return;
    setBusy(true);
    setError('');
    try {
      let user: User;
      try {
        const assertion = TotpMultiFactorGenerator.assertionForSignIn(factor.uid, String(data.get('code')));
        ({ user } = await step.resolver.resolveSignIn(assertion));
      } catch (failure) {
        if (['auth/invalid-multi-factor-session', 'auth/missing-multi-factor-session', 'auth/session-expired'].includes(errorCode(failure))) {
          setStep({ kind: 'credentials' });
          setError('The sign-in request expired. Enter your email and password again.');
        } else {
          form.querySelector<HTMLInputElement>('[name="code"]')?.select();
          setError('That code was not accepted. Enter the current code from your authenticator app.');
        }
        return;
      }
      try {
        await finishSignIn(user, step.setUp);
      } catch (failure) {
        await clearFirebaseSignIn(firebaseAuth());
        setStep({ kind: 'credentials' });
        setError(knownMessage(failure));
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || step.kind !== 'setup') return;
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      const code = String(new FormData(form).get('code'));
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(step.secret, code);
      await multiFactor(step.user).enroll(assertion, 'Vion authenticator');
      await clearFirebaseSignIn(firebaseAuth());
      setStep({ kind: 'credentials' });
      setNotice('Authenticator added. Sign in again with your email, password and authenticator code.');
    } catch (failure) {
      const code = errorCode(failure);
      if (['auth/code-expired', 'auth/session-expired', 'auth/invalid-multi-factor-session', 'auth/requires-recent-login'].includes(code)) {
        await clearFirebaseSignIn(firebaseAuth());
        setStep({ kind: 'credentials' });
        setError('Setup expired. Sign in and select authenticator setup again.');
      } else {
        form.querySelector<HTMLInputElement>('[name="code"]')?.select();
        setError(code === 'auth/invalid-verification-code'
          ? 'That code was not accepted. Enter the current code from your authenticator app.'
          : 'Unable to add the authenticator. Try again or contact your CMS administrator.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (busy) return;
    setBusy(true);
    if (step.kind === 'setup') await clearFirebaseSignIn(firebaseAuth());
    setStep({ kind: 'credentials' });
    setError('');
    setBusy(false);
  }

  const status = <>
    {notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
  </>;
  const factors = step.kind === 'challenge' ? totpFactors(step.resolver) : [];

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-md rounded-3xl bg-white p-9 shadow-sm">
        <img src="/approved/assets/logo-dark.svg" alt="Vion Africa Travel" className="mb-9 w-40" />
        {step.kind === 'credentials' && <>
          <h1 className="text-3xl font-extrabold">Staff sign in</h1>
          <p className="mb-7 mt-3 text-sm text-neutral-700">Your authorised Vion workspace.</p>
          <form onSubmit={submitCredentials} className="space-y-5">
            <label className="block text-sm font-bold">Email<input required type="email" name="email" autoComplete="username" className="mt-2" /></label>
            <label className="block text-sm font-bold">Password<input required type="password" name="password" autoComplete="current-password" className="mt-2" /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="setup" className="!w-auto" />Set up an authenticator</label>
            {status}
            <button disabled={busy} className={buttonStyle}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <p className="mt-6 text-xs text-neutral-600">Accounts are provisioned by your administrator.</p>
          <a href="/setup" className="mt-4 inline-block text-sm underline">Installation status</a>
        </>}
        {step.kind === 'challenge' && <>
          <h1 className="text-3xl font-extrabold">Verify your sign-in</h1>
          <p className="mb-7 mt-3 text-sm text-neutral-700">Enter the six-digit code shown in your authenticator app.</p>
          <form onSubmit={submitChallenge} className="space-y-5">
            {factors.length > 1
              ? <label className="block text-sm font-bold">Authenticator
                <select name="factor" className="mt-2">{factors.map((factor, index) =>
                  <option key={factor.uid} value={factor.uid}>{factor.displayName || ('Authenticator ' + (index + 1))}</option>
                )}</select>
              </label>
              : <input type="hidden" name="factor" value={factors[0]?.uid} />}
            <CodeField label="Authenticator code" />
            {status}
            <button disabled={busy} className={buttonStyle}>{busy ? 'Verifying…' : 'Verify and continue'}</button>
            <button type="button" disabled={busy} onClick={cancel} className="text-sm underline">Back to sign in</button>
          </form>
        </>}
        {step.kind === 'setup' && <>
          <h1 className="text-3xl font-extrabold">Set up an authenticator</h1>
          <p className="mb-4 mt-3 text-sm text-neutral-700">In your authenticator app, add a time-based account for Vion CMS using this setup key.</p>
          <code className="mb-6 block break-all rounded-lg bg-neutral-100 p-3 text-sm">{step.secret.secretKey}</code>
          <form onSubmit={submitSetup} className="space-y-5">
            <CodeField label="Code from your app" />
            {status}
            <button disabled={busy} className={buttonStyle}>{busy ? 'Adding…' : 'Add authenticator'}</button>
            <button type="button" disabled={busy} onClick={cancel} className="text-sm underline">Cancel setup</button>
          </form>
        </>}
      </section>
    </main>
  );
}
