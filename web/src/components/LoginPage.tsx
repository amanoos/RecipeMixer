import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChefHat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, login } from '@/lib/api';
import { useDocumentTitle } from '@/lib/use-document-title';

/** The password form shown when the server asks for a login. Nothing about the app is shown behind it. */
export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  useDocumentTitle('Log in');
  const field = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    field.current?.focus();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setError('Enter the password.');
      field.current?.focus();
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await login(password);
      setPassword('');
      onLoggedIn();
    } catch (err) {
      // The field is emptied after every failed try, so a wrong password is never left sitting on screen.
      setPassword('');
      setError(
        err instanceof ApiError
          ? err.status === 401
            ? 'Incorrect password.'
            : err.message
          : 'Could not reach the server. Is it running?',
      );
      field.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-4 py-8">
      <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <ChefHat aria-hidden="true" className="size-5 text-primary" />
        RecipeMixer
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-busy={busy}>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Log in</h1>
          <p className="text-sm text-muted-foreground">This library is private. Enter the password to open it.</p>
        </div>

        {/* There is no user name, but password managers want one to file the login under; this fixed, hidden one gives them it. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          defaultValue="recipemixer"
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        />

        <div className="space-y-2">
          <Label htmlFor="login-password">Password</Label>
          <Input
            ref={field}
            id="login-password"
            type="password"
            autoComplete="current-password"
            spellCheck={false}
            autoCapitalize="none"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={200}
            aria-invalid={error !== null}
            aria-describedby={error ? 'login-error' : undefined}
          />
        </div>

        {error && (
          <p id="login-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Checking...' : 'Log in'}
        </Button>
      </form>
    </main>
  );
}
