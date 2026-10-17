import { useEffect, useState, type MouseEvent } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { ChefHat, LogOut, Moon, Plus, Sun } from 'lucide-react';
import { RouteFocus } from '@/components/RouteFocus';
import { ServerStatus } from '@/components/ServerStatus';
import { Button, buttonVariants } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
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

/** Keeps the address clean (no #main) while still moving focus to the page content. */
function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  document.getElementById('main')?.focus();
}

export function Layout() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const { authRequired, logout } = useAuth();
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function handleLogout() {
    setLogoutError(null);
    try {
      await logout();
    } catch {
      // Say so rather than pretending: if the server was not reached the session is still open.
      setLogoutError('Could not log out. Check your connection and try again.');
    }
  }

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
      <a
        href="#main"
        onClick={skipToContent}
        className="sr-only rounded-md bg-background px-3 py-2 text-sm font-medium shadow-md outline-none focus:not-sr-only focus:absolute focus:top-2 focus:left-4 focus:z-50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Skip to content
      </a>

      <header className="border-b">
        {/* On a phone the logo and theme button share the first row and the links wrap beneath. */}
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3">
          <Link to="/" className="mr-auto inline-flex items-center gap-2 text-lg font-semibold tracking-tight pointer-coarse:min-h-11">
            <ChefHat aria-hidden="true" className="size-5 text-primary" />
            RecipeMixer
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="sm:order-3"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <nav aria-label="Main" className="flex w-full flex-wrap items-center gap-1 sm:order-2 sm:w-auto">
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
            {authRequired && (
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut aria-hidden="true" />
                Log out
              </Button>
            )}
          </nav>
          {logoutError && (
            <p role="alert" className="w-full text-sm text-destructive">
              {logoutError}
            </p>
          )}
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 outline-none">
        <Outlet />
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <ServerStatus />
        </div>
      </footer>

      <RouteFocus targetId="main" />
    </div>
  );
}
