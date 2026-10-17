import { createContext, useContext } from 'react';

export interface AuthState {
  /** Whether the server asks for a password, so whether there is anything to log out of. */
  authRequired: boolean;
  /** Ends the session on the server. Rejects if that could not be done, so the user is not told they are logged out when they are not. */
  logout: () => Promise<void>;
}

/** The default is "no password", which is how the app behaves when it is not wrapped in the AuthGate (as in most tests). */
export const AuthContext = createContext<AuthState>({ authRequired: false, logout: async () => undefined });

export const useAuth = (): AuthState => useContext(AuthContext);
