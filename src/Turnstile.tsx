import { useEffect, useRef } from 'react'

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

const scriptId = 'cloudflare-turnstile-script'
const scriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  return new Promise<TurnstileApi>((resolve, reject) => {
    const ready = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not initialize.'))
    const failed = () => reject(new Error('Turnstile could not be loaded.'))
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', ready, { once: true })
      existing.addEventListener('error', failed, { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = scriptId
    script.src = scriptUrl
    script.async = true
    script.defer = true
    script.addEventListener('load', ready, { once: true })
    script.addEventListener('error', failed, { once: true })
    document.head.appendChild(script)
  })
}

export function Turnstile({ onToken, onError, resetKey }: { onToken: (token: string) => void; onError: () => void; resetKey: number }) {
  const container = useRef<HTMLDivElement>(null)
  const tokenCallback = useRef(onToken)
  const errorCallback = useRef(onError)
  tokenCallback.current = onToken
  errorCallback.current = onError
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY

  useEffect(() => {
    if (!siteKey || !container.current) return
    let active = true
    let widgetId = ''
    void loadTurnstile().then(api => {
      if (!active || !container.current) return
      widgetId = api.render(container.current, {
        sitekey: siteKey,
        action: 'application',
        theme: 'light',
        size: 'flexible',
        callback: (token: string) => tokenCallback.current(token),
        'expired-callback': () => tokenCallback.current(''),
        'error-callback': () => { tokenCallback.current(''); errorCallback.current() }
      })
    }).catch(() => { if (active) errorCallback.current() })
    return () => {
      active = false
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey, resetKey])

  if (!siteKey) return <p className="turnstile-error" role="alert">Application verification is not configured. Please contact the school directly.</p>
  return <div className="turnstile-wrap"><div ref={container} aria-label="Automated submission verification" /></div>
}
