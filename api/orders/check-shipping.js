const { supabaseAdmin } = require('../_lib/supabase');
const { getUserFromRequest } = require('../_lib/auth');
const { ok, fail, handleCors } = require('../_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);

  const tokenUser = getUserFromRequest(req);
  if (!tokenUser || !tokenUser.id) {
    return fail(res, '로그인이 필요합니다', 401);
  }

  const { broadcastId, subtotal } = req.body;

  if (!broadcastId || subtotal == null) {
    return fail(res, '필수 정보가 누락되었습니다');
  }

  let shippingFee = subtotal >= 100000 ? 0 : 4000;
  let shippingRefund = 0;

  // 동일방송 동일회원 기존 주문 조회
  const { data: prevOrders, error: prevErr } = await supabaseAdmin
    .from('orders')
    .select('subtotal, shipping_fee, shipping_refund')
    .eq('broadcast_id', parseInt(broadcastId))
    .eq('user_id', tokenUser.id)
    .neq('status', '취소');

  let cumulativeSubtotal = subtotal;

  if (!prevErr && prevOrders && prevOrders.length > 0) {
    const previousSubtotal = prevOrders.reduce((s, o) => s + o.subtotal, 0);
    const previousShippingFees = prevOrders.reduce((s, o) => s + o.shipping_fee, 0);
    const previousRefunds = prevOrders.reduce((s, o) => s + (o.shipping_refund || 0), 0);
    cumulativeSubtotal = previousSubtotal + subtotal;

    if (cumulativeSubtotal >= 100000) {
      shippingFee = 0;
      shippingRefund = Math.max(0, previousShippingFees - previousRefunds);
    }
  }

  const total = subtotal + shippingFee - shippingRefund;

  return ok(res, {
    shippingFee,
    shippingRefund,
    total,
    cumulativeSubtotal,
  });
};
