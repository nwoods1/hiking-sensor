import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase } from '@/supabase/client';
import { syncService } from '@/sync/syncService';

type SignUpResult = { needsConfirmation: boolean };

type AuthContextValue = {
  session: Session | null;
  initializing: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<SignUpResult>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Anonymous Supabase users don't count as signed in (frontend/auth.js).
function signedIn(session: Session | null): Session | null {
  return session?.user && !session.user.is_anonymous ? session : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (mounted) setSession(signedIn(data.session));
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setInitializing(false);
      });

    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(signedIn(next));
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') syncService.notifyChanged();
      if (event === 'SIGNED_IN') void syncService.requestSync({ force: true });
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = {
    session,
    initializing,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp(email, password) {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      // With email confirmation on, Supabase returns no session yet.
      return { needsConfirmation: !data.session };
    },
    async signOut() {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

// For screens that are only reachable while signed in.
export function useUserId(): string {
  const { session } = useAuth();
  if (!session) throw new Error('Not signed in');
  return session.user.id;
}
