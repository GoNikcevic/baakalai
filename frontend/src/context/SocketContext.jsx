/* ===============================================================================
   BAKAL — Socket Context (React)
   Provides a shared Socket.io connection to all components.
   Connects on auth, disconnects on logout.
   =============================================================================== */

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { connect, disconnect, reconnect, getSocket } from '../services/socket';

const SocketContext = createContext(null);

export function SocketProvider({ children, isAuthenticated }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      disconnect();
      setSocket(null);
      setConnected(false);
      return;
    }

    const s = connect();
    if (!s) return;

    setSocket(s);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);

    // If already connected at mount
    if (s.connected) setConnected(true);

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
    };
  }, [isAuthenticated]);

  const refreshConnection = useCallback(() => {
    const s = reconnect();
    setSocket(s);
  }, []);

  return (
    <SocketContext.Provider value={{ socket, connected, refreshConnection }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within SocketProvider');
  return ctx;
}
