import { useState, useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useApp } from './context/useApp'
import { isLoggedIn, validateToken } from './services/auth'
import { SocketProvider } from './context/SocketContext'
import AuthGate from './components/AuthGate'
import OnboardingWizard from './components/OnboardingWizard'
import Layout from './components/Layout'
import { DashboardSkeleton } from './components/Skeleton'

const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const CampaignsList = lazy(() => import('./pages/CampaignsList'))
const CampaignDetailRoute = lazy(() => import('./pages/CampaignDetailRoute'))
const PerformancePage = lazy(() => import('./pages/PerformancePage'))
const RecosPage = lazy(() => import('./pages/RecosPage'))
const MemoryExplorerPage = lazy(() => import('./pages/MemoryExplorerPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'))
const CRMAnalyticsPage = lazy(() => import('./pages/CRMAnalyticsPage'))
const ClientsPage = lazy(() => import('./pages/ClientsPage'))
const NurturePage = lazy(() => import('./pages/NurturePage'))
const JoinTeamPage = lazy(() => import('./pages/JoinTeamPage'))
const LegalPage = lazy(() => import('./pages/LegalPage'))

// Public routes accessible without authentication
const PUBLIC_PATHS = ['/reset-password', '/legal', '/terms', '/privacy']

export default function App() {
  const { initData } = useApp()
  const location = useLocation()
  const [authed, setAuthed] = useState(null) // null = checking, true/false
  const [onboarded, setOnboarded] = useState(() =>
    localStorage.getItem('bakal_onboarding_complete') === 'true'
  )

  // Re-initialize data after onboarding completes
  // (initial initData may have run before onboarding was done)
  function handleOnboardingComplete() {
    setOnboarded(true)
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
            window.history.replaceState({}, '', '/')
            setAuthed(true)
          })
          .catch(err => {
            console.error('[google-auth] Exchange error:', err)
            window.history.replaceState({}, '', '/')
          })
      }

      if (params.get('error')) {
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
          return
        }
      }
      setAuthed(false)
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
      }}>Chargement...</div>}>
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

  if (authed === null) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg-primary)', color: 'var(--text-muted)',
        fontFamily: 'var(--font)',
      }}>
        Chargement...
      </div>
    )
  }

  if (!authed) {
    return <AuthGate onAuth={() => setAuthed(true)} />
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
            <Route path="/copyeditor" element={<Navigate to="/campaigns" replace />} />
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/recos" element={<RecosPage />} />
            <Route path="/memory" element={<MemoryExplorerPage />} />
            <Route path="/profil" element={<ProfilePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/crm-analytics" element={<CRMAnalyticsPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/nurture" element={<NurturePage />} />
            <Route path="/join/:code" element={<JoinTeamPage />} />
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </SocketProvider>
  )
}
