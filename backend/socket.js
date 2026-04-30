/* ===============================================================================
   BAKAL — Socket.io Server
   Real-time communication layer: chat, notifications, live stats updates.
   Authenticated via JWT — same tokens as the REST API.
   =============================================================================== */

const { Server } = require('socket.io');
const { verifyToken } = require('./middleware/auth');

let io = null;

// Track connected users: userId → Set<socketId>
const connectedUsers = new Map();

// Limits
const MAX_SOCKETS_PER_USER = 10;

/**
 * Initialize Socket.io on an existing HTTP server.
 * @param {import('http').Server} httpServer
 * @param {string[]} allowedOrigins - CORS origins
 * @returns {import('socket.io').Server}
 */
function init(httpServer, allowedOrigins) {
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
    // Limit payload size to prevent abuse
    maxHttpBufferSize: 1e6, // 1MB
  });

  // ── Auth middleware — validate JWT on connection ──
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const user = verifyToken(token);
      socket.user = user;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  // ── Connection handler ──
  io.on('connection', (socket) => {
    const userId = socket.user.id;

    // Enforce per-user connection limit
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, new Set());
    }
    const userSockets = connectedUsers.get(userId);

    if (userSockets.size >= MAX_SOCKETS_PER_USER) {
      // Disconnect oldest socket for this user
      const oldestId = userSockets.values().next().value;
      const oldSocket = io.sockets.sockets.get(oldestId);
      if (oldSocket) {
        oldSocket.disconnect(true);
      }
      userSockets.delete(oldestId);
    }

    userSockets.add(socket.id);

    // Join user's private room (for targeted notifications)
    socket.join(`user:${userId}`);

    // ── Chat: join a thread room (verify ownership) ──
    socket.on('chat:join', async (threadId) => {
      if (typeof threadId !== 'string' || threadId.length > 100) return;
      try {
        const db = require('./db');
        const thread = await db.query(
          'SELECT id FROM chat_threads WHERE id = $1 AND user_id = $2',
          [threadId, userId]
        );
        if (thread.rows.length > 0) {
          socket.join(`thread:${threadId}`);
        }
      } catch { /* deny silently */ }
    });

    socket.on('chat:leave', (threadId) => {
      socket.leave(`thread:${threadId}`);
    });

    // ── Disconnect ──
    socket.on('disconnect', () => {
      const sockets = connectedUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          connectedUsers.delete(userId);
        }
      }
    });
  });

  return io;
}

/**
 * Get the Socket.io server instance.
 */
function getIO() {
  return io;
}

/**
 * Gracefully close all socket connections.
 */
function close() {
  if (io) {
    io.close();
    connectedUsers.clear();
  }
}

// ── Emit helpers — called from routes/orchestrator ──

function notifyUser(userId, event, data) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

function emitToThread(threadId, event, data) {
  if (!io) return;
  io.to(`thread:${threadId}`).emit(event, data);
}

function notifyCampaignUpdate(userId, campaign) {
  notifyUser(userId, 'campaign:updated', campaign);
}

function notifyStatsRefresh(userId, data) {
  notifyUser(userId, 'stats:refreshed', data);
}

function isUserOnline(userId) {
  return connectedUsers.has(userId);
}

function getConnectedUserCount() {
  return connectedUsers.size;
}

module.exports = {
  init,
  getIO,
  close,
  notifyUser,
  emitToThread,
  notifyCampaignUpdate,
  notifyStatsRefresh,
  isUserOnline,
  getConnectedUserCount,
};
