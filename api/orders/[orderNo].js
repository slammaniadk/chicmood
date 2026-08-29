const { supabaseAdmin } = require('../_lib/supabase');
const { getUserFromRequest } = require('../_lib/auth');
const { ok, fail, handleCors } = require('../_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'PATCH') return fail(res, 'Method not allowed', 405);

  const { orderNo } = req.query;
  const { action } = req.body;

  if (action !== 'cancel') return fail(res, '지원하지 않는 작업입니다');

  // JWT 인증
  const user = getUserFromRequest(req);
  if (!user || !user.id) return fail(res, '로그인이 필요합니다', 401);

  // 주문 조회
  const { data: order, error: oErr } = await supabaseAdmin
    .from('orders')
    .select('id, status, user_id')
    .eq('order_no', orderNo)
    .single();

  if (oErr || !order) return fail(res, '주문을 찾을 수 없습니다', 404);

  // 본인 주문만 취소 가능
  if (order.user_id !== user.id) return fail(res, '본인의 주문만 취소할 수 있습니다', 403);

  // 취소 가능 상태 확인
  const CANCELLABLE = ['입금확인', '결제완료'];
  if (!CANCELLABLE.includes(order.status)) {
    return fail(res, `현재 상태(${order.status})에서는 취소할 수 없습니다`);
  }

  // 주문 아이템 조회 (재고 복원용)
  const { data: items, error: iErr } = await supabaseAdmin
    .from('order_items')
    .select('product_id, qty')
    .eq('order_id', order.id);

  if (iErr) return fail(res, iErr.message, 500);

  // 상태를 결제취소로 변경
  const { error: uErr } = await supabaseAdmin
    .from('orders')
    .update({ status: '결제취소' })
    .eq('id', order.id);

  if (uErr) return fail(res, uErr.message, 500);

  // available_qty 복원 (해당 상품의 qty만큼)
  const qtyMap = {};
  (items || []).forEach(i => {
    if (!i.product_id) return;
    qtyMap[i.product_id] = (qtyMap[i.product_id] || 0) + (i.qty || 0);
  });

  for (const [productId, qty] of Object.entries(qtyMap)) {
    const { data: prod } = await supabaseAdmin
      .from('products')
      .select('id, available_qty')
      .eq('id', productId)
      .single();
    if (!prod || prod.available_qty === null || prod.available_qty === undefined) continue;
    await supabaseAdmin
      .from('products')
      .update({ available_qty: prod.available_qty + qty })
      .eq('id', parseInt(productId));
  }

  return ok(res, { orderNo, status: '결제취소' });
};
