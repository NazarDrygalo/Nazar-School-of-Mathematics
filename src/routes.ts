export type Page = 'home' | 'information' | 'apply' | 'contact' | 'academic-support' | 'resources' | 'portal' | 'admin' | 'parent' | 'student' | 'tutor' | 'privacy' | 'terms'

export const pagePaths: Record<Page, string> = {
  home: '/',
  information: '/math',
  'academic-support': '/science-and-essay-writing',
  resources: '/resources',
  apply: '/apply',
  contact: '/contact',
  portal: '/portal',
  admin: '/admin',
  parent: '/parent',
  student: '/student',
  tutor: '/tutor',
  privacy: '/privacy',
  terms: '/terms'
}

const pages = Object.keys(pagePaths) as Page[]
const pathPages = new Map(pages.map(page => [pagePaths[page], page]))

function normalizedPath() {
  const path = location.pathname.replace(/\/+$/, '')
  return path || '/'
}

function legacyHashPage(): Page | null {
  if (!location.hash.startsWith('#/')) return null
  const value = location.hash.slice(2) || 'home'
  return pages.includes(value as Page) ? value as Page : null
}

export function currentPage(): Page {
  if (location.hash.includes('type=recovery')) return 'portal'
  return legacyHashPage() || pathPages.get(normalizedPath()) || 'home'
}

export function normalizeLegacyRoute() {
  if (location.hash.includes('type=recovery')) return
  const page = legacyHashPage()
  if (page) history.replaceState({}, '', pagePaths[page])
}

export function navigateTo(page: Page, replace = false) {
  const method = replace ? 'replaceState' : 'pushState'
  history[method]({}, '', pagePaths[page])
  window.dispatchEvent(new PopStateEvent('popstate'))
}

