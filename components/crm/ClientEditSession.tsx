"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type Session = { version: number; busy: boolean; setBusy: (busy: boolean) => void; saved: (version: number) => void };
const Context = createContext<Session | null>(null);
export function useClientEditSession() { return useContext(Context); }
export default function ClientEditSession({ version, children }: { version: number; children: ReactNode }) {
  const [savedVersion, setSavedVersion] = useState(version);
  const [busy, setBusy] = useState(false);
  return <Context.Provider value={{ version: Math.max(version, savedVersion), busy, setBusy, saved: (next) => setSavedVersion((current) => Math.max(current, next)) }}>{children}</Context.Provider>;
}
