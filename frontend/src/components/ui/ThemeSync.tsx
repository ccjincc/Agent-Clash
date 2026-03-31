'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/store';

export default function ThemeSync() {
  useEffect(() => {
    const apply = (theme: 'light' | 'dark') => {
      const root = document.documentElement;
      if (theme === 'dark') root.classList.add('dark');
      else root.classList.remove('dark');
    };

    let prev = useAppStore.getState().theme;
    apply(prev);
    const unsub = useAppStore.subscribe((s) => {
      if (s.theme !== prev) {
        prev = s.theme;
        apply(prev);
      }
    });
    return () => unsub();
  }, []);

  return null;
}
