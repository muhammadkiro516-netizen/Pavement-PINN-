/**
 * Services the shell host gives to pages (see App.tsx).
 */
import { createContext, useContext } from 'react';
import { UserAccount } from '../features/authentication/demoAccounts';

export interface PageHostValue {
  /** Go back to the signed-in account's home tab. */
  closePage: () => void;
  /** After a successful sign-in: show the account and land on its route. */
  completeLogin: (account: UserAccount, nextPath?: string | null) => void;
  /** End the session and return to the login page. */
  logout: () => void;
}

export const PageHostContext = createContext<PageHostValue | null>(null);

export function usePageHost(): PageHostValue {
  const value = useContext(PageHostContext);
  if (!value) throw new Error('usePageHost must be used inside the app shell');
  return value;
}
