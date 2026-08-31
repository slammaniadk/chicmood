const { supabaseAdmin } = require('./_lib/supabase');
const { getUserFromRequest } = require('./_lib/auth');
const { ok, fail, handleCors } = require('./_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  // GET: 배송비 확인 (체크아웃 미리보기용)
  if (req.method === 'GET') {
    const tokenUser = getUserFromRequest(req);
    if (!tokenUser || !tokenUser.id) return fail(res, '로그인이 필요합니다', 401);

    const broadcastId = req.query.broadcastId;
    const subtotal = parseInt(req.query.subtotal) || 0;
    if (!broadcastId || !subtotal) return fail(res, '필수 정보가 누락되었습니다');

    let shippingFee = subtotal >= 100000 ? 0 : 4000;
    let shippingRefund = 0;
    let cumulativeSubtotal = subtotal;

    const { data: prevOrders, error: prevErr } = await supabaseAdmin
      .from('orders')
      .select('subtotal, shipping_fee, shipping_refund')
      .eq('broadcast_id', parseInt(broadcastId))
      .eq('user_id', tokenUser.id)
      .neq('status', '결제취소');

    if (!prevErr && prevOrders && prevOrders.length > 0) {
      // 동일방송 2차 주문부터는 무조건 배송비 무료
      shippingFee = 0;

      const previousSubtotal = prevOrders.reduce((s, o) => s + o.subtotal, 0);
      const previousShippingFees = prevOrders.reduce((s, o) => s + o.shipping_fee, 0);
      const previousRefunds = prevOrders.reduce((s, o) => s + (o.shipping_refund || 0), 0);
      cumulativeSubtotal = previousSubtotal + subtotal;

      // 누적 10만원 이상이면 이전에 납부한 배송비 환급
      if (cumulativeSubtotal >= 100000) {
        shippingRefund = Math.max(0, previousShippingFees - previousRefunds);
      }
    }

    return ok(res, { shippingFee, shippingRefund, total: subtotal + shippingFee - shippingRefund, cumulativeSubtotal });
  }

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

  // 종료된 방송 주문 차단
  const { data: bc, error: bcErr } = await supabaseAdmin
    .from('broadcasts').select('id, status').eq('id', parseInt(broadcastId)).single();
  if (bcErr || !bc) {
    return fail(res, '방송 정보를 찾을 수 없습니다');
  }
  if (bc.status === 'ended') {
    return fail(res, '종료된 방송의 상품은 주문할 수 없습니다');
  }

  // 서버에서 가격 계산 (클라이언트 가격 무시) - 판매가(wholesale_price) 우선 사용
  const productIds = items.map(i => i.productId);
  const { data: products, error: pErr } = await supabaseAdmin
    .from('products')
    .select('id, name, price, wholesale_price, available_qty')
    .in('id', productIds);

  if (pErr) return fail(res, pErr.message, 500);

  const priceMap = {};
  const productMap = {};
  products.forEach(p => { priceMap[p.id] = p.wholesale_price || p.price; productMap[p.id] = p; });

  // 판매가능수량 체크 (available_qty가 지정된 상품만)
  for (const item of items) {
    const prod = productMap[item.productId];
    if (!prod || prod.available_qty === null || prod.available_qty === undefined) continue;
    const requestQty = Math.max(1, Math.min(99, parseInt(item.qty) || 1));
    if (prod.available_qty < requestQty) {
      const remain = prod.available_qty <= 0 ? '품절' : `잔여 ${prod.available_qty}개`;
      return fail(res, `${prod.name} 주문 불가 (${remain})`);
    }
  }

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

  if (parseInt(broadcastId)) {
    const { data: prevOrders, error: prevErr } = await supabaseAdmin
      .from('orders')
      .select('subtotal, shipping_fee, shipping_refund')
      .eq('broadcast_id', parseInt(broadcastId))
      .eq('user_id', userId)
      .neq('status', '결제취소');

    if (!prevErr && prevOrders && prevOrders.length > 0) {
      // 동일방송 2차 주문부터는 무조건 배송비 무료
      shippingFee = 0;

      const previousSubtotal = prevOrders.reduce((s, o) => s + o.subtotal, 0);
      const previousShippingFees = prevOrders.reduce((s, o) => s + o.shipping_fee, 0);
      const previousRefunds = prevOrders.reduce((s, o) => s + (o.shipping_refund || 0), 0);
      const cumulativeSubtotal = previousSubtotal + subtotal;

      // 누적 10만원 이상이면 이전에 납부한 배송비 환급
      if (cumulativeSubtotal >= 100000) {
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
    status: '입금확인',
  };
  if (parseInt(broadcastId)) orderData.broadcast_id = parseInt(broadcastId);

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
    status: '입금확인',
  }));

  const { error: iErr } = await supabaseAdmin
    .from('order_items')
    .insert(itemsToInsert);

  if (iErr) return fail(res, iErr.message, 500);

  // 판매가능수량 차감 (available_qty가 지정된 상품만)
  for (const item of orderItems) {
    const prod = productMap[item.product_id];
    if (!prod || prod.available_qty === null || prod.available_qty === undefined) continue;
    await supabaseAdmin.from('products')
      .update({ available_qty: Math.max(0, prod.available_qty - item.qty) })
      .eq('id', item.product_id);
  }

  // YouTube 라이브 채팅 주문 알림 (fire-and-forget, 실패해도 주문에 영향 없음)
  if (broadcastId) {
    try {
      const { sendOrderNotification } = require('./_lib/youtube');
      sendOrderNotification(parseInt(broadcastId), social || name, orderItems, total)
        .catch(err => console.error('[YouTube 알림 실패]', err.message || err));
    } catch(e) { console.error('[YouTube 모듈 로드 실패]', e.message); }
  }

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
