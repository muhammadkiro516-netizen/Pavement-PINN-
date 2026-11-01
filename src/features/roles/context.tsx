import { createContext, useContext } from 'react';
import type { V5Role } from '../../domain/v5/model';
import type { V6Role } from '../../domain/v6/roles';

export interface StaffPerson {
  accountId: string;
  role: V6Role;
  displayName: string;
}

export interface V5ContextValue {
  /** The duty being looked at: an OM's approvals or queue, for example. The server picks its own per action. */
  role: V5Role;
  v6Role: V6Role | null;
  /** Null for a citizen. */
  accountId: string | null;
  staff: StaffPerson[];
  signOut: () => void;
  go: (path: string) => void;
}

export const V5Context = createContext<V5ContextValue>(null as unknown as V5ContextValue);
export const useV5 = () => useContext(V5Context);
