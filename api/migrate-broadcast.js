const { supabaseAdmin } = require('./_lib/supabase');
const { ok, fail, handleCors } = require('./_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);

  const key = req.query.key;
  if (key !== 'chicmood-migrate-2026') return fail(res, 'Unauthorized', 401);

  const results = [];

  try {
    // 1) broadcast_id 컬럼 존재 확인
    const { data: testRow, error: testErr } = await supabaseAdmin
      .from('orders')
      .select('broadcast_id')
      .limit(1);

    if (testErr && testErr.message.includes('broadcast_id')) {
      return ok(res, {
        error: 'broadcast_id 컬럼이 없습니다. Supabase SQL Editor에서 다음 SQL을 먼저 실행해주세요:',
        sql: 'ALTER TABLE orders ADD COLUMN IF NOT EXISTS broadcast_id INTEGER REFERENCES broadcasts(id) ON DELETE SET NULL; CREATE INDEX IF NOT EXISTS idx_orders_broadcast_id ON orders(broadcast_id);'
      });
    }

    // 2) broadcast_id가 null인 주문 조회
    const { data: orders } = await supabaseAdmin
      .from('orders')
      .select('id, order_no')
      .is('broadcast_id', null);

    if (!orders || orders.length === 0) {
      return ok(res, { message: '모든 주문에 이미 broadcast_id가 설정되어 있습니다', count: 0 });
    }

    results.push(`broadcast_id 미설정 주문 ${orders.length}건 발견`);

    // 3) 각 주문에 대해 order_items → products → broadcast_products 매핑
    let updated = 0;
    for (const order of orders) {
      const { data: items } = await supabaseAdmin.from('order_items')
        .select('product_id').eq('order_id', order.id);

      if (!items || items.length === 0) continue;

      const productIds = items.filter(i => i.product_id).map(i => i.product_id);
      if (productIds.length === 0) continue;

      // broadcast_products에서 해당 상품들의 방송 조회
      const { data: bcProducts } = await supabaseAdmin.from('broadcast_products')
        .select('broadcast_id')
        .in('product_id', productIds)
        .order('broadcast_id', { ascending: false })
        .limit(1);

      if (bcProducts && bcProducts.length > 0) {
        const broadcastId = bcProducts[0].broadcast_id;
        const { error: updateErr } = await supabaseAdmin.from('orders')
          .update({ broadcast_id: broadcastId })
          .eq('id', order.id);

        if (!updateErr) {
          updated++;
          results.push(`${order.order_no} → broadcast_id: ${broadcastId}`);
        }
      }
    }

    results.push(`총 ${updated}/${orders.length}건 업데이트 완료`);

    return ok(res, { results, updated, total: orders.length });
  } catch (e) {
    return fail(res, e.message, 500);
  }
};
