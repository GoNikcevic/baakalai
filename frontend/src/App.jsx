import { useState, useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useApp } from './context/useApp'
import { isLoggedIn, validateToken } from './services/auth'
import { SocketProvider } from './context/SocketContext'
import AuthGate from './components/AuthGate'
import OnboardingWizard from './components/OnboardingWizard'
import Layout from './components/Layout'
import { DashboardSkeleton } from './components/Skeleton'

// Auto-reload on stale chunk (after deploy, old chunk hashes don't exist)
function lazyRetry(importFn) {
  return lazy(() => importFn().catch((err) => {
    const hasReloaded = sessionStorage.getItem('chunk_reload')
    if (!hasReloaded) {
      sessionStorage.setItem('chunk_reload', '1')
      window.location.reload()
      // Return a never-resolving promise to prevent React from rendering an error
      // while the page reloads
      return new Promise(() => {})
    }
    // Already reloaded once — clear the flag for next deploy and throw
    sessionStorage.removeItem('chunk_reload')
    throw err
  }))
}

const ResetPasswordPage = lazyRetry(() => import('./pages/ResetPasswordPage'))
const ChatPage = lazyRetry(() => import('./pages/ChatPage'))
const DashboardPage = lazyRetry(() => import('./pages/DashboardPage'))
const CampaignsList = lazyRetry(() => import('./pages/CampaignsList'))
const CampaignDetailRoute = lazyRetry(() => import('./pages/CampaignDetailRoute'))
const PerformancePage = lazyRetry(() => import('./pages/PerformancePage'))
const RecosPage = lazyRetry(() => import('./pages/RecosPage'))
const ClientsPage = lazyRetry(() => import('./pages/ClientsPage'))
const ActivationPage = lazyRetry(() => import('./pages/ActivationPage'))
const AnalyticsPage = lazyRetry(() => import('./pages/AnalyticsPage'))
const SettingsWrapper = lazyRetry(() => import('./pages/SettingsWrapper'))
const JoinTeamPage = lazyRetry(() => import('./pages/JoinTeamPage'))
const LegalPage = lazyRetry(() => import('./pages/LegalPage'))

// Public routes accessible without authentication
const PUBLIC_PATHS = ['/reset-password', '/legal', '/terms', '/privacy']

export default function App() {
  const { initData } = useApp()
  const location = useLocation()
  const [authed, setAuthed] = useState(null) // null = checking, true/false
  const [onboarded, setOnboarded] = useState(null) // null = checking, true/false
  const [authError, setAuthError] = useState(null)

  // Re-initialize data after onboarding completes
  // (initial initData may have run before onboarding was done)
  function handleOnboardingComplete() {
    setOnboarded(true)
    localStorage.setItem('bakal_onboarding_complete', 'true')
    initData()
  }

  // Handle Google OAuth callback — exchange one-time code for tokens
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('auth') === 'google') {
      const code = params.get('code')

      if (code) {
        fetch('/api/auth/exchange-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        })
          .then(res => res.ok ? res.json() : Promise.reject(new Error('Code exchange failed')))
          .then(data => {
            localStorage.setItem('bakal_token', data.token)
            if (data.refreshToken) localStorage.setItem('bakal_refresh_token', data.refreshToken)
            localStorage.setItem('bakal_user', JSON.stringify(data.user))
            if (data.user.onboarding_complete) {
              localStorage.setItem('bakal_onboarding_complete', 'true')
            } else {
              localStorage.removeItem('bakal_onboarding_complete')
            }
            window.history.replaceState({}, '', '/')
            setAuthed(true)
            setOnboarded(!!data.user.onboarding_complete)
          })
          .catch(err => {
            console.error('[google-auth] Exchange error:', err)
            setAuthError('Google sign-in failed. Please try again.')
            window.history.replaceState({}, '', '/')
          })
      }

      if (params.get('error')) {
        setAuthError('Google sign-in failed. Please try again.')
        window.history.replaceState({}, '', '/')
      }
    }
  }, [])

  useEffect(() => {
    async function checkAuth() {
      if (isLoggedIn()) {
        const valid = await validateToken()
        if (valid) {
          setAuthed(true)
          // onboarding flag was synced to localStorage by validateToken
          setOnboarded(localStorage.getItem('bakal_onboarding_complete') === 'true')
          return
        }
      }
      setAuthed(false)
      setOnboarded(false)
    }
    checkAuth()
  }, [])

  useEffect(() => {
    if (authed) {
      initData()
    }
  }, [authed, initData])

  // Allow public routes without authentication
  const isPublicRoute = PUBLIC_PATHS.some(p => location.pathname.startsWith(p))
  if (isPublicRoute) {
    return (
      <Suspense fallback={<div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg-primary)', color: 'var(--text-muted)',
        fontFamily: 'var(--font)',
      }}>Loading...</div>}>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/legal" element={<LegalPage />} />
          <Route path="/terms" element={<Navigate to="/legal" replace />} />
          <Route path="/privacy" element={<Navigate to="/legal#privacy" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    )
  }

  if (authed === null || (authed && onboarded === null)) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg-primary)', color: 'var(--text-muted)',
        fontFamily: 'var(--font)',
      }}>
        Loading...
      </div>
    )
  }

  if (!authed) {
    return <AuthGate onAuth={() => {
      setAuthed(true)
      setOnboarded(localStorage.getItem('bakal_onboarding_complete') === 'true')
    }} error={authError} />
  }

  if (!onboarded) {
    return <OnboardingWizard onComplete={handleOnboardingComplete} />
  }

  const fallback = (
    <div style={{ marginLeft: 240, padding: '28px 32px' }}>
      <DashboardSkeleton />
    </div>
  )

  return (
    <SocketProvider isAuthenticated={authed}>
      <Suspense fallback={fallback}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/campaigns" element={<CampaignsList />} />
            <Route path="/campaigns/:id" element={<CampaignDetailRoute />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/activation" element={<ActivationPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/settings" element={<SettingsWrapper />} />
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/recos" element={<RecosPage />} />
            <Route path="/help" element={<Navigate to="/chat" replace />} />
            <Route path="/join/:code" element={<JoinTeamPage />} />
            {/* Redirects for old routes */}
            <Route path="/nurture" element={<Navigate to="/activation" replace />} />
            <Route path="/signals" element={<Navigate to="/activation" replace />} />
            <Route path="/crm-analytics" element={<Navigate to="/analytics" replace />} />
            <Route path="/membership" element={<Navigate to="/analytics" replace />} />
            <Route path="/profil" element={<Navigate to="/settings" replace />} />
            <Route path="/memory" element={<Navigate to="/settings" replace />} />
            <Route path="/integrations" element={<Navigate to="/settings" replace />} />
            <Route path="/copyeditor" element={<Navigate to="/campaigns" replace />} />
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </SocketProvider>
  )
}
