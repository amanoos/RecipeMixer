import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LoginPage } from '@/components/LoginPage';
import { Button } from '@/components/ui/button';
import { getSession, logout as apiLogout, onUnauthorized } from '@/lib/api';
import { AuthContext, type AuthState } from '@/lib/auth';

type Phase = 'checking' | 'ready' | 'login' | 'error';

/**
 * Asks the server whether a login is needed before showing anything. With no password the app opens at once;
 * with one, the login page comes first and the app only appears once it has been used.
 *
 * If the session ends while the app is open (it expired, or was ended elsewhere), the login comes back and the
 * page stays behind it, hidden but not thrown away, so a recipe being edited is not lost. After a deliberate
 * log out the app is removed completely instead.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [authRequired, setAuthRequired] = useState(false);
  const [keepAppBehindLogin, setKeepAppBehindLogin] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setPhase('checking');
    getSession(controller.signal)
      .then((status) => {
        setAuthRequired(status.authRequired);
        setPhase(!status.authRequired || status.authenticated ? 'ready' : 'login');
      })
      .catch(() => {
        if (!controller.signal.aborted) setPhase('error');
      });
    return () => controller.abort();
  }, [attempt]);

  // Any request answered with "login required" while the app is open brings the login back.
  useEffect(
    () =>
      onUnauthorized(() => {
        setKeepAppBehindLogin(true);
        setPhase((current) => (current === 'ready' ? 'login' : current));
      }),
    [],
  );

  const logout = useCallback(async () => {
    await apiLogout();
    setKeepAppBehindLogin(false);
    setGeneration((value) => value + 1);
    setPhase('login');
  }, []);

  const value = useMemo<AuthState>(() => ({ authRequired, logout }), [authRequired, logout]);

  if (phase === 'checking') {
    // Nothing visible until the server has answered, so neither the login form nor the app flashes first.
    return <div aria-busy="true" aria-label="Loading" className="min-h-screen" />;
  }

  if (phase === 'error') {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-3 px-4 text-center">
        <p role="alert">Could not reach the server. Is it running?</p>
        <Button variant="outline" onClick={() => setAttempt((count) => count + 1)}>
          Try again
        </Button>
      </main>
    );
  }

  const loginShown = phase === 'login';
  return (
    <AuthContext.Provider value={value}>
      {loginShown && <LoginPage onLoggedIn={() => setPhase('ready')} />}
      {(!loginShown || keepAppBehindLogin) && (
        <div key={generation} hidden={loginShown}>
          {children}
        </div>
      )}
    </AuthContext.Provider>
  );
}
