import { createContext, useContext } from 'react';
import type { V5Role } from '../../domain/v5/model';

export interface StaffPerson {
  accountId: string;
  role: V5Role;
  displayName: string;
}

export interface V5ContextValue {
  role: V5Role;
  /** Null for a citizen. */
  accountId: string | null;
  staff: StaffPerson[];
  signOut: () => void;
  go: (path: string) => void;
}

export const V5Context = createContext<V5ContextValue>(null as unknown as V5ContextValue);
export const useV5 = () => useContext(V5Context);
