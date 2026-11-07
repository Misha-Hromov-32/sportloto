import { createContext, useContext } from 'react';

import type { UiSettings } from './settings';

export interface SettingsContextValue {
  settings: UiSettings;
  update: (patch: Partial<UiSettings>) => void;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings вызван вне ThemeProvider');
  return ctx;
}
