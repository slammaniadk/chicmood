const { supabaseAdmin } = require('./_lib/supabase');
const { getUserFromRequest } = require('./_lib/auth');
const { ok, fail, handleCors } = require('./_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);

  const { name, phone, social, address, memo, items, broadcastId } = req.body;

  // 필수 필드 검증
  if (!name || !phone || !address) {
    return fail(res, '이름, 전화번호, 주소는 필수입니다');
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return fail(res, '주문 상품이 없습니다');
  }

  // 로그인 필수
  const tokenUser = getUserFromRequest(req);
  if (!tokenUser || !tokenUser.id) {
    return fail(res, '주문하시려면 로그인이 필요합니다', 401);
  }
  const userId = tokenUser.id;

  // 방송 없이 주문 차단
  if (!broadcastId) {
    return fail(res, '방송을 통해서만 주문이 가능합니다');
  }

  // 서버에서 가격 계산 (클라이언트 가격 무시) - 판매가(wholesale_price) 우선 사용
  const productIds = items.map(i => i.productId);
  const { data: products, error: pErr } = await supabaseAdmin
    .from('products')
    .select('id, price, wholesale_price')
    .in('id', productIds);

  if (pErr) return fail(res, pErr.message, 500);

  const priceMap = {};
  products.forEach(p => { priceMap[p.id] = p.wholesale_price || p.price; });

  // 주문 항목 가격 계산
  const orderItems = items.map(item => {
    const price = priceMap[item.productId];
    if (!price) return null;
    const qty = Math.max(1, Math.min(99, parseInt(item.qty) || 1));
    return {
      product_id: item.productId,
      name: item.name,
      color: item.color,
      size: item.size,
      qty,
      price,
      subtotal: price * qty,
    };
  }).filter(Boolean);

  if (orderItems.length === 0) {
    return fail(res, '유효한 상품이 없습니다');
  }

  const subtotal = orderItems.reduce((s, i) => s + i.subtotal, 0);

  // 동일방송 동일회원 누적 배송비 로직
  let shippingFee = subtotal >= 100000 ? 0 : 4000;
  let shippingRefund = 0;

  if (broadcastId) {
    const { data: prevOrders, error: prevErr } = await supabaseAdmin
      .from('orders')
      .select('subtotal, shipping_fee, shipping_refund')
      .eq('broadcast_id', parseInt(broadcastId))
      .eq('user_id', userId)
      .neq('status', '취소');

    if (!prevErr && prevOrders && prevOrders.length > 0) {
      const previousSubtotal = prevOrders.reduce((s, o) => s + o.subtotal, 0);
      const previousShippingFees = prevOrders.reduce((s, o) => s + o.shipping_fee, 0);
      const previousRefunds = prevOrders.reduce((s, o) => s + (o.shipping_refund || 0), 0);
      const cumulativeSubtotal = previousSubtotal + subtotal;

      if (cumulativeSubtotal >= 100000) {
        shippingFee = 0;
        shippingRefund = Math.max(0, previousShippingFees - previousRefunds);
      }
    }
  }

  const total = subtotal + shippingFee - shippingRefund;

  // 주문번호 생성 (DB 시퀀스 기반)
  const { data: seqData, error: seqErr } = await supabaseAdmin
    .rpc('nextval', { seq_name: 'order_seq' });

  // nextval RPC가 없으면 fallback
  let orderSeq;
  if (seqErr) {
    // raw query fallback
    const { data: rawSeq, error: rawErr } = await supabaseAdmin
      .from('orders')
      .select('id')
      .limit(1);
    orderSeq = Date.now() % 100000;
  } else {
    orderSeq = seqData;
  }

  const now = new Date();
  const ds = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const orderNo = `CM-${ds}-${String(orderSeq).padStart(4, '0')}`;

  // 주문 생성
  const orderData = {
    order_no: orderNo,
    user_id: userId,
    name,
    phone,
    social: social || null,
    address,
    memo: memo || null,
    subtotal,
    shipping_fee: shippingFee,
    shipping_refund: shippingRefund,
    total,
    status: '입금대기',
  };
  if (broadcastId) orderData.broadcast_id = parseInt(broadcastId);

  let order, oErr;
  ({ data: order, error: oErr } = await supabaseAdmin
    .from('orders')
    .insert(orderData)
    .select('id, order_no, subtotal, shipping_fee, total, status, created_at')
    .single());

  // 컬럼이 아직 없으면 제외 후 재시도
  if (oErr && oErr.message) {
    if (oErr.message.includes('broadcast_id')) delete orderData.broadcast_id;
    if (oErr.message.includes('shipping_refund')) delete orderData.shipping_refund;
    ({ data: order, error: oErr } = await supabaseAdmin
      .from('orders')
      .insert(orderData)
      .select('id, order_no, subtotal, shipping_fee, total, status, created_at')
      .single());
  }

  if (oErr) return fail(res, oErr.message, 500);

  // 주문 항목 삽입
  const itemsToInsert = orderItems.map(item => ({
    ...item,
    order_id: order.id,
  }));

  const { error: iErr } = await supabaseAdmin
    .from('order_items')
    .insert(itemsToInsert);

  if (iErr) return fail(res, iErr.message, 500);

  return ok(res, {
    orderNo: order.order_no,
    subtotal: order.subtotal,
    shippingFee: order.shipping_fee,
    shippingRefund: shippingRefund,
    total: order.total,
    status: order.status,
    items: orderItems.map(i => ({
      name: i.name,
      color: i.color,
      size: i.size,
      qty: i.qty,
      price: i.price,
      subtotal: i.subtotal,
    })),
    createdAt: order.created_at,
  }, 201);
};
