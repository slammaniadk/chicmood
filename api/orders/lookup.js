const { supabaseAdmin } = require('../_lib/supabase');
const { ok, fail, handleCors } = require('../_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);

  const { name, phoneLast4 } = req.body;

  if (!name || !phoneLast4) {
    return fail(res, '이름과 전화번호 뒤 4자리를 입력해주세요');
  }
  if (!/^\d{4}$/.test(phoneLast4)) {
    return fail(res, '전화번호 뒤 4자리(숫자)를 정확히 입력해주세요');
  }

  // 이름 일치 + 전화번호 뒤4자리 매칭
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select(`
      id, order_no, name, phone, social, address, memo,
      subtotal, shipping_fee, total, status, created_at, broadcast_id,
      order_items ( id, product_id, name, color, size, qty, price, subtotal )
    `)
    .eq('name', name)
    .like('phone', `%${phoneLast4}`)
    .order('created_at', { ascending: false });

  if (error) return fail(res, error.message, 500);

  // 모든 product_id 수집 → 대표 이미지 조회
  const productIds = [...new Set(
    orders.flatMap(o => (o.order_items || []).map(i => i.product_id).filter(Boolean))
  )];
  const imageMap = {};
  if (productIds.length > 0) {
    const { data: images } = await supabaseAdmin
      .from('product_images')
      .select('product_id, image_url')
      .in('product_id', productIds)
      .order('sort_order', { ascending: true });
    (images || []).forEach(img => {
      if (!imageMap[img.product_id]) imageMap[img.product_id] = img.image_url;
    });
  }

  const result = orders.map(o => ({
    orderNo: o.order_no,
    name: o.name,
    phone: o.phone,
    address: o.address,
    memo: o.memo,
    subtotal: o.subtotal,
    shippingFee: o.shipping_fee,
    total: o.total,
    status: o.status,
    createdAt: o.created_at,
    broadcastId: o.broadcast_id,
    items: (o.order_items || []).map(i => ({
      productId: i.product_id,
      name: i.name,
      color: i.color,
      size: i.size,
      qty: i.qty,
      price: i.price,
      subtotal: i.subtotal,
      image: (i.product_id && imageMap[i.product_id]) || null,
    })),
  }));

  return ok(res, result);
};
