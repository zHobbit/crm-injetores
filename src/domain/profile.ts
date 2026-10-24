import type { Contact } from './types'

// Perfil do cliente vive em Contact.custom['profile'] (CustomField scope contact, code 'profile').
export const PROFILES = ['bombista', 'mecanico', 'revendedor', 'cliente_final'] as const
export type Profile = (typeof PROFILES)[number]

export const PROFILE_LABEL: Record<Profile, string> = {
  bombista: 'Bombista',
  mecanico: 'Mecânico',
  revendedor: 'Revendedor',
  cliente_final: 'Cliente Final',
}

export const PROFILE_CLASS: Record<Profile, string> = {
  bombista: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  mecanico: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  revendedor: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  cliente_final: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
}

export const isProfile = (v: unknown): v is Profile => PROFILES.includes(v as Profile)

export const profileOf = (contact: Contact | null | undefined): Profile | null => {
  const v = contact?.custom['profile']
  return isProfile(v) ? v : null
}
