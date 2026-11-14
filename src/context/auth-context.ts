import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  /** Resolves to true when the user must confirm their email before signing in. */
  signUp: (email: string, password: string) => Promise<boolean>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)
