/* ===============================================================================
   BAKAL · Notification Context (React)
   Provides toast notifications via React context, replacing DOM-based system.
   =============================================================================== */

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { registerReactToast } from '../services/notifications';

const NotificationContext = createContext(null);

let _idCounter = 0;

export function NotificationProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const removeToast = useCallback((id) => {
    // Mark as removing for exit animation
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, removing: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      if (timersRef.current[id]) {
        clearTimeout(timersRef.current[id]);
        delete timersRef.current[id];
      }
    }, 300);
  }, []);

  const showToast = useCallback(({ type = 'info', title, message, duration = 5000 }) => {
    const id = 'toast-' + (++_idCounter);
    const toast = { id, type, title, message, duration, removing: false, createdAt: Date.now() };
    setToasts((prev) => [...prev, toast]);

    if (duration > 0) {
      timersRef.current[id] = setTimeout(() => removeToast(id), duration);
    }

    return id;
  }, [removeToast]);

  // Register with imperative bridge so showToast() calls from non-React code work
  useEffect(() => {
    registerReactToast(showToast);
    return () => registerReactToast(null);
  }, [showToast]);

  const value = { toasts, showToast, removeToast };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
