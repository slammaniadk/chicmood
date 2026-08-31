const { supabaseAdmin } = require('../_lib/supabase');
const { getUserFromRequest } = require('../_lib/auth');
const { ok, fail, handleCors } = require('../_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);

  const user = getUserFromRequest(req);
  if (!user) return fail(res, '로그인이 필요합니다', 401);

  const { broadcastId, items } = req.body;
  if (!broadcastId || !Array.isArray(items) || items.length === 0) {
    return fail(res, '잘못된 요청입니다');
  }

  // 현재 라이브 방송 ID로 보정 (장바구니에 이전 방송 ID가 남아있을 수 있음)
  let finalBcId = parseInt(broadcastId);
  const { data: liveBc } = await supabaseAdmin
    .from('broadcasts').select('id').eq('status', 'live').limit(1).single();
  if (liveBc && liveBc.id !== finalBcId) finalBcId = liveBc.id;

  // 해당 방송에서 이 사용자의 기존 주문 조회 (결제취소 제외)
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_items ( product_id, name, color, size )')
    .eq('broadcast_id', finalBcId)
    .eq('user_id', user.id)
    .neq('status', '결제취소');

  if (error) return fail(res, error.message, 500);

  // 기존 주문의 상품 목록을 Set으로 변환 (productId+color+size 키)
  const existingSet = new Set();
  const existingMap = {};
  for (const order of orders) {
    for (const item of (order.order_items || [])) {
      const key = `${item.product_id}|${item.color}|${item.size}`;
      existingSet.add(key);
      existingMap[key] = { productId: item.product_id, name: item.name, color: item.color, size: item.size };
    }
  }

  // 요청 아이템과 비교하여 중복 목록 추출
  const duplicates = [];
  for (const item of items) {
    const key = `${item.productId}|${item.color}|${item.size}`;
    if (existingSet.has(key)) {
      duplicates.push(existingMap[key]);
    }
  }

  return ok(res, { duplicates });
};
