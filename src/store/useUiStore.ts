import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Profile } from '../domain/profile'
import type { RecencyLevel } from '../domain/recency'

interface UiState {
  theme: 'dark' | 'light'
  query: string
  profileFilter: Profile | 'all'
  recencyFilter: RecencyLevel | 'all'
  drawerDealId: string | null
  drawerOpen: boolean
  importOpen: boolean
  toggleTheme: () => void
  setQuery: (q: string) => void
  setProfileFilter: (p: Profile | 'all') => void
  setRecencyFilter: (r: RecencyLevel | 'all') => void
  openDrawer: (id: string | null) => void
  closeDrawer: () => void
  setImportOpen: (v: boolean) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      query: '',
      profileFilter: 'all',
      recencyFilter: 'all',
      drawerDealId: null,
      drawerOpen: false,
      importOpen: false,
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setQuery: (query) => set({ query }),
      setProfileFilter: (profileFilter) => set({ profileFilter }),
      setRecencyFilter: (recencyFilter) => set({ recencyFilter }),
      openDrawer: (drawerDealId) => set({ drawerOpen: true, drawerDealId }),
      closeDrawer: () => set({ drawerOpen: false, drawerDealId: null }),
      setImportOpen: (importOpen) => set({ importOpen }),
    }),
    {
      name: 'crm.ui.v1',
      partialize: (s) => ({ theme: s.theme }),
    },
  ),
)
