const { supabaseAdmin } = require('./_lib/supabase');
const { ok, fail, handleCors } = require('./_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);
  const { secret } = req.body;
  if (secret !== 'chicmood-migrate-2026') return fail(res, 'Unauthorized', 403);

  // 1) 기존 발주서 전부 삭제 (cascade로 items도 삭제)
  await supabaseAdmin.from('purchase_orders').delete().neq('id', 0);

  // 2) order_items에 product_id가 없는 것들 상품명 매칭으로 복구
  const { data: allProducts } = await supabaseAdmin.from('products').select('id, name');
  const { data: allItems } = await supabaseAdmin.from('order_items').select('id, product_id, name').is('product_id', null);
  let fixed = 0;
  for (const item of (allItems || [])) {
    const matched = (allProducts || []).find(p => item.name && (p.name === item.name || p.name.includes(item.name) || item.name.includes(p.name)));
    if (matched) {
      await supabaseAdmin.from('order_items').update({ product_id: matched.id }).eq('id', item.id);
      fixed++;
    }
  }

  // 3) 방송-상품 매핑 조회
  const { data: bcProducts } = await supabaseAdmin.from('broadcast_products')
    .select('product_id, broadcast_id, broadcasts(id, title)')
    .order('broadcast_id', { ascending: false });
  const productBroadcastMap = {};
  (bcProducts || []).forEach(bp => {
    if (!productBroadcastMap[bp.product_id]) {
      productBroadcastMap[bp.product_id] = {
        broadcastId: bp.broadcast_id,
        broadcastTitle: bp.broadcasts ? bp.broadcasts.title : '',
      };
    }
  });

  // 4) 결제완료 주문 전체 조회 및 발주 생성
  const { data: orders } = await supabaseAdmin.from('orders')
    .select('id').eq('status', '결제완료');

  let processed = 0, skipped = 0;
  // 전체 발주 그룹 (거래처+방송 단위)
  const allGroups = {};

  for (const order of (orders || [])) {
    const { data: items } = await supabaseAdmin.from('order_items')
      .select('product_id, name, color, size, qty').eq('order_id', order.id);
    if (!items || items.length === 0) { skipped++; continue; }

    // product_id 없으면 상품명 매칭
    for (const item of items) {
      if (!item.product_id && item.name) {
        const matched = (allProducts || []).find(p => p.name === item.name || p.name.includes(item.name) || item.name.includes(p.name));
        if (matched) item.product_id = matched.id;
      }
    }

    const validItems = items.filter(i => i.product_id);
    if (validItems.length === 0) { skipped++; continue; }

    const productIds = [...new Set(validItems.map(i => i.product_id))];
    const { data: products } = await supabaseAdmin.from('products')
      .select('id, name, vendor_id, cost_price').in('id', productIds);
    if (!products || products.length === 0) { skipped++; continue; }

    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });

    for (const item of validItems) {
      const prod = productMap[item.product_id];
      if (!prod || !prod.vendor_id) continue;
      const bc = productBroadcastMap[item.product_id] || { broadcastId: 0, broadcastTitle: '' };
      const groupKey = `${prod.vendor_id}_${bc.broadcastId}`;
      if (!allGroups[groupKey]) {
        allGroups[groupKey] = { vendorId: prod.vendor_id, broadcastId: bc.broadcastId, broadcastTitle: bc.broadcastTitle, items: [] };
      }
      // 동일 품목이면 수량 합산
      const existing = allGroups[groupKey].items.find(ei =>
        ei.product_id === item.product_id && ei.color_name === (item.color || '') && ei.size_name === (item.size || '')
      );
      if (existing) {
        existing.qty += item.qty;
      } else {
        allGroups[groupKey].items.push({
          product_id: item.product_id,
          product_name: item.name || prod.name,
          color_name: item.color || '',
          size_name: item.size || '',
          qty: item.qty,
          cost_price: prod.cost_price || 0,
        });
      }
    }
    processed++;
  }

  // 5) 그룹별 발주서 생성
  let poCreated = 0;
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;

  for (const group of Object.values(allGroups)) {
    const bcTag = group.broadcastId ? `[BC:${group.broadcastId}]` : '[BC:0]';
    const memoPrefix = group.broadcastTitle || '방송 미지정';
    const { count } = await supabaseAdmin.from('purchase_orders')
      .select('id', { count: 'exact', head: true }).ilike('po_no', `PO-${dateStr}%`);
    const poNo = `PO-${dateStr}-${String((count || 0) + 1).padStart(3, '0')}`;
    const totalAmount = group.items.reduce((s, i) => s + i.qty * i.cost_price, 0);

    const { data: newPO } = await supabaseAdmin.from('purchase_orders')
      .insert({ po_no: poNo, vendor_id: group.vendorId, status: '발주대기', total_amount: totalAmount, memo: `${bcTag} ${memoPrefix}` })
      .select('id').single();
    if (!newPO) continue;

    await supabaseAdmin.from('purchase_order_items').insert(
      group.items.map(i => ({
        purchase_order_id: newPO.id, product_id: i.product_id,
        product_name: i.product_name, color_name: i.color_name,
        size_name: i.size_name, qty: i.qty, cost_price: i.cost_price,
        subtotal: i.qty * i.cost_price,
      }))
    );
    poCreated++;
  }

  return ok(res, {
    message: '마이그레이션 완료',
    orderItemsFixed: fixed,
    ordersProcessed: processed,
    ordersSkipped: skipped,
    purchaseOrdersCreated: poCreated,
    groups: Object.values(allGroups).map(g => ({
      vendorId: g.vendorId, broadcastTitle: g.broadcastTitle || '미지정',
      itemCount: g.items.length, totalQty: g.items.reduce((s,i) => s + i.qty, 0),
    })),
  });
};
