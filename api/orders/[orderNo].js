const { supabaseAdmin } = require('../_lib/supabase');
const { getUserFromRequest } = require('../_lib/auth');
const { ok, fail, handleCors } = require('../_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'PATCH') return fail(res, 'Method not allowed', 405);

  const { orderNo } = req.query;
  const { action } = req.body;

  if (!['cancel', 'modify'].includes(action)) return fail(res, '지원하지 않는 작업입니다');

  // JWT 인증
  const user = getUserFromRequest(req);
  if (!user || !user.id) return fail(res, '로그인이 필요합니다', 401);

  // 주문 조회
  const { data: order, error: oErr } = await supabaseAdmin
    .from('orders')
    .select('id, status, user_id, broadcast_id')
    .eq('order_no', orderNo)
    .single();

  if (oErr || !order) return fail(res, '주문을 찾을 수 없습니다', 404);
  if (order.user_id !== user.id) return fail(res, '본인의 주문만 변경할 수 있습니다', 403);

  // 입금확인 상태에서만 취소/수정 가능
  if (order.status !== '입금확인') {
    return fail(res, `현재 상태(${order.status})에서는 변경할 수 없습니다`);
  }

  // 기존 주문 아이템 조회
  const { data: oldItems, error: oldErr } = await supabaseAdmin
    .from('order_items')
    .select('product_id, qty')
    .eq('order_id', order.id);

  if (oldErr) return fail(res, oldErr.message, 500);

  // === 주문 취소 ===
  if (action === 'cancel') {
    const { error: uErr } = await supabaseAdmin
      .from('orders')
      .update({ status: '결제취소' })
      .eq('id', order.id);

    if (uErr) return fail(res, uErr.message, 500);

    await restoreAvailableQty(oldItems);
    return ok(res, { orderNo, status: '결제취소' });
  }

  // === 주문 수정 ===
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return fail(res, '수정할 상품이 없습니다');
  }

  // 기존 재고 복원
  await restoreAvailableQty(oldItems);

  // 새 아이템 상품 정보 조회
  const productIds = [...new Set(items.map(i => i.productId).filter(Boolean))];
  const { data: products, error: pErr } = await supabaseAdmin
    .from('products')
    .select('id, name, price, wholesale_price, available_qty')
    .in('id', productIds);

  if (pErr) return fail(res, pErr.message, 500);

  const productMap = {};
  products.forEach(p => { productMap[p.id] = p; });

  // 재고 체크
  for (const item of items) {
    const prod = productMap[item.productId];
    if (!prod) return fail(res, '상품을 찾을 수 없습니다', 400);
    if (prod.available_qty === null || prod.available_qty === undefined) continue;
    const qty = Math.max(1, Math.min(99, parseInt(item.qty) || 1));
    if (prod.available_qty < qty) {
      const remain = prod.available_qty <= 0 ? '품절' : `잔여 ${prod.available_qty}개`;
      return fail(res, `${prod.name} 주문 불가 (${remain})`);
    }
  }

  // 새 주문 아이템 생성 (서버 가격 기준)
  const newOrderItems = items.map(item => {
    const prod = productMap[item.productId];
    const price = prod.wholesale_price || prod.price;
    const qty = Math.max(1, Math.min(99, parseInt(item.qty) || 1));
    return {
      order_id: order.id,
      product_id: item.productId,
      name: prod.name,
      color: item.color,
      size: item.size,
      qty,
      price,
      subtotal: price * qty,
      status: '입금확인',
    };
  });

  const newSubtotal = newOrderItems.reduce((s, i) => s + i.subtotal, 0);

  // 배송비 재계산 (동일방송 동일회원 기준)
  let shippingFee = newSubtotal >= 100000 ? 0 : 4000;
  let shippingRefund = 0;

  if (order.broadcast_id) {
    const { data: prevOrders, error: prevErr } = await supabaseAdmin
      .from('orders')
      .select('subtotal, shipping_fee, shipping_refund')
      .eq('broadcast_id', order.broadcast_id)
      .eq('user_id', user.id)
      .neq('status', '결제취소')
      .neq('id', order.id); // 현재 수정 중인 주문 제외

    if (!prevErr && prevOrders && prevOrders.length > 0) {
      shippingFee = 0;
      const previousSubtotal = prevOrders.reduce((s, o) => s + o.subtotal, 0);
      const previousShippingFees = prevOrders.reduce((s, o) => s + o.shipping_fee, 0);
      const previousRefunds = prevOrders.reduce((s, o) => s + (o.shipping_refund || 0), 0);
      const cumulativeSubtotal = previousSubtotal + newSubtotal;
      if (cumulativeSubtotal >= 100000) {
        shippingRefund = Math.max(0, previousShippingFees - previousRefunds);
      }
    }
  }

  const newTotal = newSubtotal + shippingFee - shippingRefund;

  // 기존 아이템 삭제 → 새 아이템 삽입
  const { error: delErr } = await supabaseAdmin
    .from('order_items').delete().eq('order_id', order.id);
  if (delErr) return fail(res, delErr.message, 500);

  const { error: insertErr } = await supabaseAdmin
    .from('order_items').insert(newOrderItems);
  if (insertErr) return fail(res, insertErr.message, 500);

  // 새 재고 차감
  for (const item of newOrderItems) {
    const prod = productMap[item.product_id];
    if (!prod || prod.available_qty === null || prod.available_qty === undefined) continue;
    await supabaseAdmin.from('products')
      .update({ available_qty: Math.max(0, prod.available_qty - item.qty) })
      .eq('id', item.product_id);
  }

  // 주문 금액 업데이트
  const updateData = { subtotal: newSubtotal, shipping_fee: shippingFee, total: newTotal };
  try { updateData.shipping_refund = shippingRefund; } catch (_) {}

  const { error: updateErr } = await supabaseAdmin
    .from('orders').update(updateData).eq('id', order.id);

  // shipping_refund 컬럼 없으면 재시도
  if (updateErr && updateErr.message && updateErr.message.includes('shipping_refund')) {
    delete updateData.shipping_refund;
    const { error: retryErr } = await supabaseAdmin
      .from('orders').update(updateData).eq('id', order.id);
    if (retryErr) return fail(res, retryErr.message, 500);
  } else if (updateErr) {
    return fail(res, updateErr.message, 500);
  }

  return ok(res, {
    orderNo,
    subtotal: newSubtotal,
    shippingFee,
    shippingRefund,
    total: newTotal,
    items: newOrderItems.map(i => ({
      productId: i.product_id,
      name: i.name,
      color: i.color,
      size: i.size,
      qty: i.qty,
      price: i.price,
      subtotal: i.subtotal,
    })),
  });
};

async function restoreAvailableQty(items) {
  const qtyMap = {};
  (items || []).forEach(i => {
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
}
