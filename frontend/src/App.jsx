import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useApp } from './context/useApp'
import { isLoggedIn, validateToken } from './services/auth'
import { SocketProvider } from './context/SocketContext'
import AuthGate from './components/AuthGate'
import OnboardingWizard from './components/OnboardingWizard'
import Layout from './components/Layout'
import ChatPage from './pages/ChatPage'
import DashboardPage from './pages/DashboardPage'
import CopyEditorPage from './pages/CopyEditorPage'
import RecosPage from './pages/RecosPage'
import ProfilePage from './pages/ProfilePage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  const { initData } = useApp()
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

  return (
    <SocketProvider isAuthenticated={authed}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/dashboard/:section" element={<DashboardPage />} />
          <Route path="/copyeditor" element={<CopyEditorPage />} />
          <Route path="/recos" element={<RecosPage />} />
          <Route path="/profil" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </SocketProvider>
  )
}
