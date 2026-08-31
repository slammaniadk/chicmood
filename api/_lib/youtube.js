const { google } = require('googleapis');
const { supabaseAdmin } = require('./supabase');

const SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];

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
 * @returns {google.auth.OAuth2} 인증된 OAuth2 클라이언트
 */
async function getAuthClient() {
  const credentials = await getYouTubeCredentials();
  if (!credentials || !credentials.refresh_token) return null;

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: credentials.refresh_token,
    access_token: credentials.access_token || undefined,
    expiry_date: credentials.expiry_date || undefined,
  });

  // access_token 만료 시 자동 갱신 후 DB에 저장
  const tokenInfo = oauth2Client.credentials;
  if (!tokenInfo.access_token || (tokenInfo.expiry_date && tokenInfo.expiry_date < Date.now())) {
    const { credentials: newTokens } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(newTokens);
    // 갱신된 토큰 DB에 저장
    await supabaseAdmin.from('system_settings').upsert({
      key: 'youtube',
      value: {
        ...credentials,
        access_token: newTokens.access_token,
        expiry_date: newTokens.expiry_date,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  }

  return oauth2Client;
}

/**
 * video ID → activeLiveChatId 조회
 */
async function getLiveChatId(videoId, auth) {
  const youtube = google.youtube({ version: 'v3', auth });
  const response = await youtube.videos.list({
    part: 'liveStreamingDetails',
    id: videoId,
  });
  const video = response.data.items && response.data.items[0];
  if (!video || !video.liveStreamingDetails) return null;
  return video.liveStreamingDetails.activeLiveChatId || null;
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
  const firstName = items[0]?.name || '상품';
  const count = items.length;
  const formattedTotal = total.toLocaleString('ko-KR');

  if (count === 1) {
    return `🛍 ${nickname}님 주문완료! ${firstName} (${formattedTotal}원)`;
  }
  return `🛍 ${nickname}님 주문완료! ${firstName} 외 ${count - 1}건 (${formattedTotal}원)`;
}

/**
 * 주문 완료 시 YouTube 라이브 채팅에 알림 발송 (fire-and-forget)
 */
async function sendOrderNotification(broadcastId, nickname, orderItems, total) {
  // 1. broadcast → youtube_video_id 조회
  const { data: bc } = await supabaseAdmin
    .from('broadcasts')
    .select('youtube_video_id')
    .eq('id', broadcastId)
    .single();
  if (!bc || !bc.youtube_video_id) return;

  // 2. OAuth 인증 클라이언트 생성
  const auth = await getAuthClient();
  if (!auth) return;

  // 3. video ID → liveChatId 조회 (라이브 중이 아니면 null)
  const liveChatId = await getLiveChatId(bc.youtube_video_id, auth);
  if (!liveChatId) return;

  // 4. 메시지 조합 및 전송
  const message = formatOrderMessage(nickname, orderItems, total);
  await sendChatMessage(liveChatId, message, auth);
}

module.exports = {
  createOAuth2Client,
  getYouTubeCredentials,
  getAuthClient,
  getLiveChatId,
  sendChatMessage,
  extractVideoId,
  formatOrderMessage,
  sendOrderNotification,
  SCOPES,
};
