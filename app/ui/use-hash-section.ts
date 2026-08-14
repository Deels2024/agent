"use client";

import { useCallback, useEffect, useState } from "react";

export function useHashSection<T extends string>(defaultSection: T, allowedSections: readonly T[]) {
  const [section, setSectionState] = useState<T>(defaultSection);

  useEffect(() => {
    const syncFromAddress = () => {
      const candidate = window.location.hash.slice(1) as T;
      setSectionState(allowedSections.includes(candidate) ? candidate : defaultSection);
    };

    syncFromAddress();
    window.addEventListener("hashchange", syncFromAddress);
    window.addEventListener("popstate", syncFromAddress);
    return () => {
      window.removeEventListener("hashchange", syncFromAddress);
      window.removeEventListener("popstate", syncFromAddress);
    };
  }, [allowedSections, defaultSection]);

  const setSection = useCallback((next: T) => {
    setSectionState(next);
    const url = new URL(window.location.href);
    url.hash = next === defaultSection ? "" : next;
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [defaultSection]);

  return [section, setSection] as const;
}
