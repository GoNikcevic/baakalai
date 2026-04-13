/* ===============================================================================
   BAKAL — Notification Helper
   Creates a persistent notification in the DB AND sends real-time via socket.
   =============================================================================== */

const db = require('../db');

/**
 * Create a persistent notification AND push it in real-time via socket.
 * @param {string} userId
 * @param {{ type: string, title: string, body?: string, metadata?: object }} opts
 * @returns {Promise<object>} The created notification row
 */
async function createNotification(userId, { type, title, body, metadata }) {
  const notif = await db.notifications.create(userId, type, title, body, metadata);
  // Send real-time via existing socket infrastructure
  const { notifyUser } = require('../socket');
  notifyUser(userId, 'notification:new', notif);
  return notif;
}

module.exports = { createNotification };
