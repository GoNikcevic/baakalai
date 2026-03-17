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

    // Track user connection
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, new Set());
    }
    connectedUsers.get(userId).add(socket.id);

    // Join user's private room (for targeted notifications)
    socket.join(`user:${userId}`);

    console.log(`🔌 Socket connected: ${socket.user.email} (${socket.id})`);

    // ── Chat: join a thread room ──
    socket.on('chat:join', (threadId) => {
      socket.join(`thread:${threadId}`);
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
      console.log(`🔌 Socket disconnected: ${socket.user.email} (${socket.id})`);
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

// ── Emit helpers — called from routes/orchestrator ──

/**
 * Send a notification to a specific user (all their connected devices).
 */
function notifyUser(userId, event, data) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

/**
 * Broadcast a chat message to everyone in a thread room.
 */
function emitToThread(threadId, event, data) {
  if (!io) return;
  io.to(`thread:${threadId}`).emit(event, data);
}

/**
 * Send a campaign update to the owning user.
 */
function notifyCampaignUpdate(userId, campaign) {
  notifyUser(userId, 'campaign:updated', campaign);
}

/**
 * Send a stats refresh signal to the owning user.
 */
function notifyStatsRefresh(userId, data) {
  notifyUser(userId, 'stats:refreshed', data);
}

/**
 * Check if a user is currently connected.
 */
function isUserOnline(userId) {
  return connectedUsers.has(userId);
}

module.exports = {
  init,
  getIO,
  notifyUser,
  emitToThread,
  notifyCampaignUpdate,
  notifyStatsRefresh,
  isUserOnline,
};
