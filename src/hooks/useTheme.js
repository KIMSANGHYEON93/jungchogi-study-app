import { useState, useEffect, useCallback, createContext, useContext } from 'react';

const STORAGE_KEY = 'jungchogi-theme';

function getInitialTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* localStorage 접근 불가(사생활 보호 모드 등) — 시스템 설정으로 폴백 */ }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* 저장 실패는 무시 — 테마는 이미 DOM에 반영됨 */ }

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f1117' : '#F0F9FF');
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  return { theme, toggle };
}

const ThemeContext = createContext({ theme: 'dark', toggle: () => {} });

export const ThemeProvider = ThemeContext.Provider;
export const useThemeContext = () => useContext(ThemeContext);
