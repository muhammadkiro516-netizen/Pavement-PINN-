import { createContext, useContext } from 'react';
import type { V5Role } from '../domain/v5/model';

export interface DemoAccount {
  accountId: string;
  personId: string;
  role: V5Role;
  displayName: string;
  orgId: string;
  note?: string;
}

export interface V5ContextValue {
  /** Server runs with DEMO_MODE=1. */
  demoServer: boolean;
  /** Server allows it and this person has the toggle on (02 §9 D-1). */
  demoEnabled: boolean;
  setDemoEnabled: (on: boolean) => void;
  role: V5Role;
  account: DemoAccount | null;
  accounts: DemoAccount[];
  switchRole: (accountId: string | null) => Promise<void>;
  go: (path: string) => void;
}

export const V5Context = createContext<V5ContextValue>(null as unknown as V5ContextValue);
export const useV5 = () => useContext(V5Context);
