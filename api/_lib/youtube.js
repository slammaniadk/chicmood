const { google } = require('googleapis');
const { supabaseAdmin } = require('./supabase');

const SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];

// ── 캐시 (서버리스 warm 인스턴스 내에서 유지) ──
let cachedAuth = null;
let cachedAuthExpiry = 0;
let authRefreshPromise = null;
const liveChatCache = new Map();
const broadcastCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10분

/**
 * OAuth2 클라이언트 생성 (환경변수에서 Client ID/Secret 사용)
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI || 'https://chicmood.vercel.app/api/admin/youtube-callback'
  );
}

/**
 * system_settings에서 YouTube OAuth 토큰 조회
 */
async function getYouTubeCredentials() {
  const { data, error } = await supabaseAdmin
    .from('system_settings')
    .select('value')
    .eq('key', 'youtube')
    .single();
  if (error || !data) return null;
  return data.value;
}

/**
 * refresh_token으로 access_token 발급 (만료 시 자동 갱신)
 * - 캐시된 인증 클라이언트 재사용
 * - 동시 갱신 요청 방지 (Promise 공유)
 */
async function getAuthClient() {
  // 캐시 유효하면 재사용 (만료 1분 전까지)
  if (cachedAuth && cachedAuthExpiry > Date.now() + 60000) {
    return cachedAuth;
  }

  // 이미 갱신 중이면 그 결과를 기다림 (동시 갱신 방지)
  if (authRefreshPromise) return authRefreshPromise;

  authRefreshPromise = (async () => {
    try {
      const credentials = await getYouTubeCredentials();
      if (!credentials || !credentials.refresh_token) return null;

      const oauth2Client = createOAuth2Client();
      oauth2Client.setCredentials({
        refresh_token: credentials.refresh_token,
        access_token: credentials.access_token || undefined,
        expiry_date: credentials.expiry_date || undefined,
      });

      const tokenInfo = oauth2Client.credentials;
      if (!tokenInfo.access_token || (tokenInfo.expiry_date && tokenInfo.expiry_date < Date.now())) {
        const { credentials: newTokens } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(newTokens);
        await supabaseAdmin.from('system_settings').upsert({
          key: 'youtube',
          value: {
            ...credentials,
            access_token: newTokens.access_token,
            expiry_date: newTokens.expiry_date,
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
        cachedAuthExpiry = newTokens.expiry_date || (Date.now() + 3600000);
      } else {
        cachedAuthExpiry = tokenInfo.expiry_date || (Date.now() + 3600000);
      }

      cachedAuth = oauth2Client;
      return oauth2Client;
    } finally {
      authRefreshPromise = null;
    }
  })();

  return authRefreshPromise;
}

/**
 * 인증 캐시 초기화 (재연동 시 호출)
 */
function clearAuthCache() {
  cachedAuth = null;
  cachedAuthExpiry = 0;
  authRefreshPromise = null;
}

/**
 * video ID → activeLiveChatId 조회 (캐시 10분)
 */
async function getLiveChatId(videoId, auth) {
  const cached = liveChatCache.get(videoId);
  if (cached && cached.expiry > Date.now()) return cached.chatId;

  const youtube = google.youtube({ version: 'v3', auth });
  const response = await youtube.videos.list({
    part: 'liveStreamingDetails',
    id: videoId,
  });
  const video = response.data.items && response.data.items[0];
  if (!video || !video.liveStreamingDetails) return null;
  const chatId = video.liveStreamingDetails.activeLiveChatId || null;

  if (chatId) {
    liveChatCache.set(videoId, { chatId, expiry: Date.now() + CACHE_TTL });
  }
  return chatId;
}

/**
 * 채팅 메시지 전송
 */
async function sendChatMessage(liveChatId, message, auth) {
  const youtube = google.youtube({ version: 'v3', auth });
  await youtube.liveChatMessages.insert({
    part: 'snippet',
    requestBody: {
      snippet: {
        liveChatId,
        type: 'textMessageEvent',
        textMessageDetails: { messageText: message },
      },
    },
  });
}

/**
 * YouTube URL에서 video ID 추출
 * 지원 형식: youtube.com/watch?v=, youtu.be/, youtube.com/live/
 */
function extractVideoId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.slice(1).split('/')[0] || null;
    }
    if (u.pathname.startsWith('/live/')) {
      return u.pathname.split('/')[2] || null;
    }
    return u.searchParams.get('v') || null;
  } catch {
    return null;
  }
}

/**
 * 주문 알림 메시지 조합
 */
function formatOrderMessage(nickname, items, total) {
  const formattedTotal = total.toLocaleString('ko-KR');
  return `🛍 ${nickname}님 주문완료!(주문금액: ${formattedTotal}원)`;
}

/**
 * 주문 완료 시 YouTube 라이브 채팅에 알림 발송 (fire-and-forget)
 * - broadcast/videoId/liveChatId/auth 모두 캐시하여 API 호출 최소화
 */
async function sendOrderNotification(broadcastId, nickname, orderItems, total) {
  // 1. broadcast → youtube_video_id 조회 (캐시)
  let videoId = broadcastCache.get(broadcastId);
  if (!videoId) {
    const { data: bc } = await supabaseAdmin
      .from('broadcasts')
      .select('youtube_video_id')
      .eq('id', broadcastId)
      .single();
    if (!bc || !bc.youtube_video_id) return;
    videoId = bc.youtube_video_id;
    broadcastCache.set(broadcastId, videoId);
  }

  // 2. OAuth 인증 클라이언트 (캐시 + 동시 갱신 방지)
  const auth = await getAuthClient();
  if (!auth) return;

  // 3. liveChatId 조회 (캐시 10분)
  const liveChatId = await getLiveChatId(videoId, auth);
  if (!liveChatId) return;

  // 4. 메시지 전송
  const message = formatOrderMessage(nickname, orderItems, total);
  await sendChatMessage(liveChatId, message, auth);
}

module.exports = {
  createOAuth2Client,
  getYouTubeCredentials,
  getAuthClient,
  clearAuthCache,
  getLiveChatId,
  sendChatMessage,
  extractVideoId,
  formatOrderMessage,
  sendOrderNotification,
  SCOPES,
};
