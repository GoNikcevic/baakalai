/* ===============================================================================
   BAKAL — Socket.io Client Service
   Manages a single shared Socket.io connection, authenticated via JWT.
   Auto-reconnects on token refresh.
   =============================================================================== */

import { io } from 'socket.io-client';
import { getToken } from './auth';

let socket = null;

/**
 * Connect to the Socket.io server using the current JWT token.
 * Returns the existing connection if already connected.
 */
export function connect() {
  const token = getToken();
  if (!token || token === 'demo-token') return null;

  if (socket?.connected) return socket;

  // Disconnect stale socket before reconnecting
  if (socket) {
    socket.disconnect();
  }

  socket = io({
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  socket.on('connect', () => {
    console.log('[socket] connected:', socket.id);
  });

  socket.on('connect_error', (err) => {
    console.warn('[socket] connection error:', err.message);
  });

  return socket;
}

/**
 * Disconnect and clean up the socket.
 */
export function disconnect() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Reconnect with a fresh token (e.g. after token refresh).
 */
export function reconnect() {
  disconnect();
  return connect();
}

/**
 * Get the current socket instance (may be null).
 */
export function getSocket() {
  return socket;
}
