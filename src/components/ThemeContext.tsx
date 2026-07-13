/**
 * ThemeContext — v1.
 *
 * Global app theme: 'dark' (default — the slate-950 look the app has
 * shipped with) or 'light' (white surfaces with dark text). The
 * choice persists in localStorage under `acadv:theme`.
 *
 * The class is set on `<html>` (not `<body>`) so it overrides the
 * entire viewport, including the print trees that mount inside the
 * root.
 *
 * On first load we read the stored value; if none exists we fall
 * back to the user's OS preference via `prefers-color-scheme`. This
 * matters because the app has always been dark — users on light-mode
 * OSes shouldn't have to discover the toggle.
 *
 * Note: the actual colour flipping is done by `index.css`
 * `:root.theme-light` override rules, NOT by changing every Tailwind
 * class. The override approach is fragile (it has to enumerate every
 * surface class) but it's the only way to retrofit a light theme
 * onto a codebase that was designed dark-first without touching
 * every component file.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'acadv:theme';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Read the persisted theme, falling back to the OS preference. */
function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* localStorage can throw in private-browsing — fall through. */
  }
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

function applyThemeClass(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // Both classes are set so the print CSS and the screen CSS can each
  // pick the rule they want — `theme-light` is the trigger for light,
  // and the absence of `theme-light` means dark (the default).
  root.classList.toggle('theme-light', theme === 'light');
  root.classList.toggle('theme-dark', theme === 'dark');
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readInitialTheme());

  // Sync <html> class on every change. Done in an effect so the very
  // first paint already reflects the persisted choice (no dark flash
  // for light-mode users).
  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private-browsing — the in-memory theme still works. */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, toggleTheme, setTheme }),
    [theme, toggleTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme() must be used inside <ThemeProvider>.');
  }
  return ctx;
}