/**
 * LinkedIn API Client (via session cookie)
 *
 * Uses the li_at session cookie to interact with LinkedIn's internal Voyager API.
 * Similar to PhantomBuster/Waalaxy approach.
 *
 * IMPORTANT: Rate limiting is critical. LinkedIn detects automation.
 * Default limits: 30 connections/day, 50 profile views/day, 20 messages/day
 *
 * All functions require the li_at cookie (stored encrypted in user_integrations).
 */

const logger = require('../lib/logger');

const VOYAGER_BASE = 'https://www.linkedin.com/voyager/api';
const HEADERS_BASE = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/vnd.linkedin.normalized+json+2.1',
  'x-li-lang': 'en_US',
  'x-restli-protocol-version': '2.0.0',
};

// Rate limiting: track actions per user per day
const _dailyCounts = new Map(); // userId → { connections, views, messages, date }

function getDailyCounts(userId) {
  const today = new Date().toISOString().split('T')[0];
  const existing = _dailyCounts.get(userId);
  if (existing && existing.date === today) return existing;
  const fresh = { connections: 0, views: 0, messages: 0, date: today };
  _dailyCounts.set(userId, fresh);
  return fresh;
}

function checkLimit(userId, type, limit) {
  const counts = getDailyCounts(userId);
  if (counts[type] >= limit) {
    throw new Error(`LinkedIn daily limit reached: ${counts[type]}/${limit} ${type}. Try again tomorrow.`);
  }
  counts[type]++;
}

// Random delay to mimic human behavior (3-8 seconds)
function humanDelay() {
  const ms = 3000 + Math.random() * 5000;
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Make a request to LinkedIn Voyager API.
 */
async function voyagerFetch(cookie, endpoint, options = {}) {
  await humanDelay();

  const csrfToken = extractCsrfToken(cookie);
  const res = await fetch(`${VOYAGER_BASE}${endpoint}`, {
    ...options,
    headers: {
      ...HEADERS_BASE,
      'cookie': `li_at=${cookie}`,
      'csrf-token': csrfToken,
      'x-li-track': '{"clientVersion":"1.13.8","mpVersion":"1.13.8","osName":"web","timezoneOffset":1}',
      ...options.headers,
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error('LinkedIn session expired. Please update your cookie.'), { code: 'SESSION_EXPIRED' });
  }
  if (res.status === 429) {
    throw Object.assign(new Error('LinkedIn rate limit hit. Slow down.'), { code: 'RATE_LIMITED' });
  }
  if (!res.ok) {
    throw new Error(`LinkedIn API ${res.status}`);
  }

  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

function extractCsrfToken(cookie) {
  // CSRF token = JSESSIONID value from cookies, or derive from li_at
  return `ajax:${Date.now()}`;
}

// ── Profile Enrichment ──

/**
 * Get a LinkedIn profile by public identifier (vanity URL).
 * Returns: { name, title, company, location, about, profileUrl }
 */
async function getProfile(cookie, publicId, userId) {
  checkLimit(userId, 'views', 50);

  const data = await voyagerFetch(cookie, `/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(publicId)}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-19`);

  const profile = data?.elements?.[0] || data?.included?.find(i => i.$type === 'com.linkedin.voyager.dash.identity.profile.Profile');
  if (!profile) return null;

  return {
    name: `${profile.firstName || ''} ${profile.lastName || ''}`.trim(),
    title: profile.headline || '',
    company: profile.topPosition?.companyName || '',
    location: profile.geoLocation?.geo?.defaultLocalizedName || '',
    about: profile.summary || '',
    profileUrl: `https://www.linkedin.com/in/${publicId}`,
    publicId,
    entityUrn: profile.entityUrn || profile['*miniProfile'] || null,
  };
}

/**
 * Search for people on LinkedIn.
 * Returns: [{ name, title, company, publicId, profileUrl }]
 */
async function searchPeople(cookie, { keywords, title, company, location, limit = 10 }, userId) {
  checkLimit(userId, 'views', 50);

  const params = new URLSearchParams({
    q: 'all',
    origin: 'GLOBAL_SEARCH_HEADER',
    keywords: keywords || '',
    start: 0,
    count: Math.min(limit, 25),
  });
  if (title) params.append('titleFreeText', title);

  const data = await voyagerFetch(cookie, `/search/dash/clusters?${params}`);

  const results = [];
  const elements = data?.elements || data?.included || [];
  for (const el of elements) {
    if (el.$type === 'com.linkedin.voyager.dash.search.EntityResultViewModel' || el.title) {
      const publicId = el.navigationUrl?.match(/\/in\/([^/?]+)/)?.[1];
      if (publicId) {
        results.push({
          name: el.title?.text || '',
          title: el.primarySubtitle?.text || '',
          company: el.secondarySubtitle?.text || '',
          publicId,
          profileUrl: `https://www.linkedin.com/in/${publicId}`,
        });
      }
    }
  }
  return results.slice(0, limit);
}

// ── Connection Requests ──

/**
 * Send a connection request with a personalized note.
 */
async function sendConnectionRequest(cookie, { profileUrn, message }, userId) {
  checkLimit(userId, 'connections', 30);

  const body = {
    trackingId: generateTrackingId(),
    message: message?.slice(0, 300) || '', // LinkedIn limits to 300 chars
    invitations: [],
    excludeInvitations: [],
    invitee: {
      'com.linkedin.voyager.growth.invitation.InviteeProfile': {
        profileId: profileUrn,
      },
    },
  };

  await voyagerFetch(cookie, '/growth/normInvitations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  logger.info('linkedin', `Connection request sent to ${profileUrn}`);
  return { success: true };
}

// ── Messages ──

/**
 * Send a direct message to a connection.
 */
async function sendMessage(cookie, { recipientUrn, message }, userId) {
  checkLimit(userId, 'messages', 20);

  const body = {
    eventCreate: {
      value: {
        'com.linkedin.voyager.messaging.create.MessageCreate': {
          body: message,
          attachments: [],
          attributedBody: { text: message, attributes: [] },
        },
      },
    },
    recipients: [recipientUrn],
    subtype: 'MEMBER_TO_MEMBER',
  };

  await voyagerFetch(cookie, '/messaging/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  logger.info('linkedin', `Message sent to ${recipientUrn}`);
  return { success: true };
}

// ── Post Monitoring ──

/**
 * Get recent posts from a person's feed.
 */
async function getRecentPosts(cookie, publicId, userId) {
  checkLimit(userId, 'views', 50);

  const data = await voyagerFetch(cookie, `/identity/profileUpdatesV2?q=memberShareFeed&moduleKey=member-shares:phone&includeLongTermHistory=true&profileId=${encodeURIComponent(publicId)}&count=5`);

  const posts = [];
  const elements = data?.elements || [];
  for (const el of elements) {
    const commentary = el.commentary?.text?.text || el.value?.['com.linkedin.voyager.feed.render.UpdateV2']?.commentary?.text?.text;
    if (commentary) {
      posts.push({
        text: commentary.slice(0, 500),
        date: el.actor?.subDescription?.text || null,
        likes: el.socialDetail?.totalSocialActivityCounts?.numLikes || 0,
        comments: el.socialDetail?.totalSocialActivityCounts?.numComments || 0,
      });
    }
  }
  return posts;
}

// ── Sync: Sent Invitations (check accepted) ──

/**
 * Get sent invitations with their status (pending/accepted).
 * Used to detect connection acceptances for memory/learning.
 */
async function getSentInvitations(cookie, { start = 0, count = 100 } = {}) {
  const data = await voyagerFetch(
    cookie,
    `/relationships/sentInvitationViewV5?invitationType=CONNECTION&start=${start}&count=${count}&q=invitationType`
  );

  const invitations = [];
  for (const el of (data?.elements || [])) {
    const invitation = el?.invitation || el;
    const invitee = invitation?.toMember || invitation?.invitee?.['com.linkedin.voyager.growth.invitation.InviteeProfile'] || {};
    invitations.push({
      id: invitation?.entityUrn || el?.entityUrn,
      sentAt: invitation?.sentTime || el?.sentTime,
      message: invitation?.message || '',
      status: el?.invitationState || 'PENDING',
      toPublicId: invitee?.publicIdentifier || invitee?.profileId || null,
      toName: `${invitee?.firstName || ''} ${invitee?.lastName || ''}`.trim(),
      toProfileUrl: invitee?.publicIdentifier ? `https://www.linkedin.com/in/${invitee.publicIdentifier}` : null,
    });
  }
  return invitations;
}

// ── Sync: Conversation Messages (check replies) ──

/**
 * Get recent conversations to detect replies to our messages.
 * Returns conversations with the latest message.
 */
async function getConversations(cookie, { count = 20 } = {}) {
  const data = await voyagerFetch(
    cookie,
    `/messaging/conversations?keyVersion=LEGACY_INBOX&q=syncToken&count=${count}`
  );

  const conversations = [];
  for (const el of (data?.elements || [])) {
    const lastMessage = el?.events?.[0] || {};
    const messageBody = lastMessage?.eventContent?.['com.linkedin.voyager.messaging.event.MessageEvent']?.body
      || lastMessage?.eventContent?.attributedBody?.text
      || '';
    const from = lastMessage?.from?.['com.linkedin.voyager.messaging.MessagingMember']
      || lastMessage?.from || {};
    const participants = (el?.participants || []).map(p => {
      const member = p?.['com.linkedin.voyager.messaging.MessagingMember'] || p;
      return {
        publicId: member?.miniProfile?.publicIdentifier || null,
        name: `${member?.miniProfile?.firstName || ''} ${member?.miniProfile?.lastName || ''}`.trim(),
      };
    });

    conversations.push({
      conversationId: el?.entityUrn,
      lastMessageAt: lastMessage?.createdAt || el?.lastActivityAt,
      lastMessageBody: messageBody.slice(0, 1000),
      lastMessageFromSelf: !!from?.miniProfile?.publicIdentifier && from.miniProfile.publicIdentifier === 'me',
      participants,
      unreadCount: el?.unreadCount || 0,
      read: el?.read ?? true,
    });
  }
  return conversations;
}

// ── Cookie Validation ──

/**
 * Test if a LinkedIn cookie is valid.
 */
async function testCookie(cookie) {
  try {
    const data = await voyagerFetch(cookie, '/me');
    return {
      valid: true,
      name: `${data?.miniProfile?.firstName || ''} ${data?.miniProfile?.lastName || ''}`.trim(),
      publicId: data?.miniProfile?.publicIdentifier,
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ── Helpers ──

function generateTrackingId() {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Buffer.from(bytes).toString('base64');
}

module.exports = {
  getProfile,
  searchPeople,
  sendConnectionRequest,
  sendMessage,
  getRecentPosts,
  getSentInvitations,
  getConversations,
  testCookie,
  getDailyCounts,
};
