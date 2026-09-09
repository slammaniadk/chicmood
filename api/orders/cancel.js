const { supabaseAdmin } = require('../_lib/supabase');
const { ok, fail, handleCors } = require('../_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);

  const { orderNo, name, phoneLast4 } = req.body;

  if (!orderNo || !name || !phoneLast4) {
    return fail(res, '주문번호, 이름, 전화번호 뒤 4자리를 모두 입력해주세요');
  }
  if (!/^\d{4}$/.test(phoneLast4)) {
    return fail(res, '전화번호 뒤 4자리(숫자)를 정확히 입력해주세요');
  }

  // 주문 조회 + 이름/전화번호 본인 확인
  const { data: order, error: oErr } = await supabaseAdmin
    .from('orders')
    .select('id, status, name, phone, order_no')
    .eq('order_no', orderNo)
    .single();

  if (oErr || !order) return fail(res, '주문을 찾을 수 없습니다', 404);
  if (order.name !== name || !order.phone.endsWith(phoneLast4)) {
    return fail(res, '본인 확인에 실패했습니다', 403);
  }

  if (order.status !== '입금확인') {
    return fail(res, `현재 상태(${order.status})에서는 취소할 수 없습니다`);
  }

  // 기존 주문 아이템 조회 (재고 복원용)
  const { data: oldItems } = await supabaseAdmin
    .from('order_items')
    .select('product_id, qty')
    .eq('order_id', order.id);

  // 주문 상태 변경
  const { error: uErr } = await supabaseAdmin
    .from('orders')
    .update({ status: '결제취소' })
    .eq('id', order.id);

  if (uErr) return fail(res, uErr.message, 500);

  // 재고 복원
  const qtyMap = {};
  (oldItems || []).forEach(i => {
    if (!i.product_id) return;
    qtyMap[i.product_id] = (qtyMap[i.product_id] || 0) + (i.qty || 0);
  });
  for (const [productId, qty] of Object.entries(qtyMap)) {
    const { data: prod } = await supabaseAdmin
      .from('products').select('id, available_qty').eq('id', productId).single();
    if (!prod || prod.available_qty === null || prod.available_qty === undefined) continue;
    await supabaseAdmin.from('products')
      .update({ available_qty: prod.available_qty + qty })
      .eq('id', parseInt(productId));
  }

  return ok(res, { orderNo, status: '결제취소' });
};
