"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_PREFS,
  getPrefsSnapshot,
  savePrefs,
  subscribePrefs,
} from "@/lib/storage";
import type { UserPrefs } from "@/lib/types";

export function usePreferences() {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefsSnapshot, () => DEFAULT_PREFS);

  const update = useCallback((patch: Partial<UserPrefs>) => {
    savePrefs({ ...getPrefsSnapshot(), ...patch });
  }, []);

  return { prefs, update };
}
