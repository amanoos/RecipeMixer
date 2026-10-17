import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Theme = 'light' | 'dark';

interface Health {
  status: string;
  schemaVersion: number;
}

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; health: Health }
  | { kind: 'error' };

const THEME_KEY = 'recipemixer-theme';

// localStorage can throw (private mode, blocked site data), so every access is guarded.
function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Persisting the theme is a convenience only; ignore storage failures.
  }
}

function initialTheme(): Theme {
  const stored = readStoredTheme();
  if (stored) return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
}

function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [healthState, setHealthState] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Health check failed with status ${response.status}`);
        return response.json() as Promise<Health>;
      })
      .then((health) => setHealthState({ kind: 'ok', health }))
      .catch(() => {
        if (!controller.signal.aborted) setHealthState({ kind: 'error' });
      });
    return () => controller.abort();
  }, []);

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    storeTheme(next);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <span className="text-lg font-semibold tracking-tight">RecipeMixer</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Welcome to RecipeMixer</CardTitle>
            <CardDescription>
              Tell it what is in your fridge and it will find something to cook. Recipe search is
              coming soon.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <Badge variant={healthState.kind === 'error' ? 'destructive' : 'secondary'}>
              {healthState.kind === 'ok' ? 'online' : healthState.kind === 'error' ? 'offline' : '...'}
            </Badge>
            <p role="status" className="text-sm text-muted-foreground">
              {healthState.kind === 'loading' && 'Checking server...'}
              {healthState.kind === 'ok' &&
                `Server is running (database schema v${healthState.health.schemaVersion}).`}
              {healthState.kind === 'error' && 'Cannot reach the server.'}
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

export default App;
