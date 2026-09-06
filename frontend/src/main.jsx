import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import { NotificationProvider } from './context/NotificationContext'
import { I18nProvider } from './i18n'
import ErrorBoundary from './components/ErrorBoundary'
import ToastContainer from './components/ToastContainer'
import { ConfirmProvider } from './components/ConfirmModal'
import App from './App.jsx'
import './index.css'

// Apply saved theme (default to light)
const savedTheme = localStorage.getItem('bakal-theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <I18nProvider>
          <NotificationProvider>
            <AppProvider>
              <ConfirmProvider>
                <App />
                <ToastContainer />
              </ConfirmProvider>
            </AppProvider>
          </NotificationProvider>
        </I18nProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
