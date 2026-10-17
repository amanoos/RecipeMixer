import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { Moon, Plus, Sun } from 'lucide-react';
import { ServerStatus } from '@/components/ServerStatus';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Theme = 'light' | 'dark';

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

export function Layout() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    storeTheme(next);
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            RecipeMixer
          </Link>
          <div className="flex items-center gap-1">
            <NavLink
              to="/match"
              className={({ isActive }) => cn(buttonVariants({ variant: 'ghost', size: 'sm' }), isActive && 'bg-muted')}
            >
              What can I cook?
            </NavLink>
            <NavLink
              to="/import"
              className={({ isActive }) => cn(buttonVariants({ variant: 'ghost', size: 'sm' }), isActive && 'bg-muted')}
            >
              Import
            </NavLink>
            <Link to="/recipes/new" className={buttonVariants({ size: 'sm' })}>
              <Plus aria-hidden="true" />
              New recipe
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <ServerStatus />
        </div>
      </footer>
    </div>
  );
}
