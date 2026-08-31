'use client';

import { Moon, Sun } from 'lucide-react';

export default function ThemeToggle() {
  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;

    try {
      window.localStorage?.setItem('bhoomix-theme', next);
    } catch {
      // Theme switching should still work when storage is blocked by the browser.
    }
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title="Toggle color theme"
      aria-label="Toggle color theme"
      className="bhoomix-theme-toggle"
    >
      <span className="bhoomix-theme-toggle-track" aria-hidden="true">
        <span className="bhoomix-theme-toggle-thumb">
          <Moon className="bhoomix-theme-dark-content h-3.5 w-3.5" />
          <Sun className="bhoomix-theme-light-content h-3.5 w-3.5" />
        </span>
      </span>
      <span className="bhoomix-theme-dark-content bhoomix-theme-label text-[10px] font-bold">Dark</span>
      <span className="bhoomix-theme-light-content bhoomix-theme-label text-[10px] font-bold">Light</span>
    </button>
  );
}
