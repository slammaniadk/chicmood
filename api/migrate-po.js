const { supabaseAdmin } = require('./_lib/supabase');
const { ok, fail, handleCors } = require('./_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);

  // 간단한 비밀 키 보호
  const { secret } = req.body;
  if (secret !== 'chicmood-migrate-2026') return fail(res, 'Unauthorized', 403);

  // 1) 관리자 계정 role 복구
  await supabaseAdmin.from('users')
    .update({ role: 'admin' })
    .eq('phone', '01000000000');

  // 2) 결제완료 주문 전체 조회
  const { data: orders, error } = await supabaseAdmin.from('orders')
    .select('id').eq('status', '결제완료');
  if (error) return fail(res, error.message, 500);
  if (!orders || orders.length === 0) return ok(res, { message: '결제완료 주문이 없습니다', created: 0, adminFixed: true });

  let processed = 0, skipped = 0;

  for (const order of orders) {
    try {
      // 주문 품목 조회
      const { data: items } = await supabaseAdmin.from('order_items')
        .select('product_id, name, color, size, qty').eq('order_id', order.id);
      if (!items || items.length === 0) { skipped++; continue; }

      const validItems = items.filter(i => i.product_id);
      if (validItems.length === 0) { skipped++; continue; }

      // 상품 정보 조회
      const productIds = [...new Set(validItems.map(i => i.product_id))];
      const { data: products } = await supabaseAdmin.from('products')
        .select('id, name, vendor_id, cost_price').in('id', productIds);
      if (!products || products.length === 0) { skipped++; continue; }

      const productMap = {};
      products.forEach(p => { productMap[p.id] = p; });

      // vendor_id 기준 그룹핑
      const vendorGroups = {};
      for (const item of validItems) {
        const prod = productMap[item.product_id];
        if (!prod || !prod.vendor_id) continue;
        const vid = prod.vendor_id;
        if (!vendorGroups[vid]) vendorGroups[vid] = [];
        vendorGroups[vid].push({
          product_id: item.product_id,
          product_name: item.name || prod.name,
          color_name: item.color || '',
          size_name: item.size || '',
          qty: item.qty,
          cost_price: prod.cost_price || 0,
        });
      }

      // 거래처별 발주서 생성/합산
      for (const [vendorId, poItemsList] of Object.entries(vendorGroups)) {
        const { data: existingPO } = await supabaseAdmin.from('purchase_orders')
          .select('id').eq('vendor_id', parseInt(vendorId)).eq('status', '발주대기')
          .order('id', { ascending: false }).limit(1).single();

        let poId;
        if (existingPO) {
          poId = existingPO.id;
          const { data: existingItems } = await supabaseAdmin.from('purchase_order_items')
            .select('id, product_id, product_name, color_name, size_name, qty, cost_price')
            .eq('purchase_order_id', poId);

          for (const newItem of poItemsList) {
            const match = (existingItems || []).find(ei =>
              ei.product_id === newItem.product_id &&
              ei.color_name === newItem.color_name &&
              ei.size_name === newItem.size_name
            );
            if (match) {
              const newQty = match.qty + newItem.qty;
              const newSubtotal = newQty * (match.cost_price || newItem.cost_price);
              await supabaseAdmin.from('purchase_order_items')
                .update({ qty: newQty, subtotal: newSubtotal }).eq('id', match.id);
            } else {
              await supabaseAdmin.from('purchase_order_items').insert({
                purchase_order_id: poId, product_id: newItem.product_id,
                product_name: newItem.product_name, color_name: newItem.color_name,
                size_name: newItem.size_name, qty: newItem.qty,
                cost_price: newItem.cost_price, subtotal: newItem.qty * newItem.cost_price,
              });
            }
          }
          // total_amount 재계산
          const { data: updatedItems } = await supabaseAdmin.from('purchase_order_items')
            .select('subtotal').eq('purchase_order_id', poId);
          const newTotal = (updatedItems || []).reduce((s, i) => s + (i.subtotal || 0), 0);
          await supabaseAdmin.from('purchase_orders').update({
            total_amount: newTotal, updated_at: new Date().toISOString()
          }).eq('id', poId);
        } else {
          const now = new Date();
          const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
          const { count } = await supabaseAdmin.from('purchase_orders')
            .select('id', { count: 'exact', head: true }).ilike('po_no', `PO-${dateStr}%`);
          const poNo = `PO-${dateStr}-${String((count || 0) + 1).padStart(3, '0')}`;

          const totalAmount = poItemsList.reduce((s, i) => s + i.qty * i.cost_price, 0);
          const { data: newPO } = await supabaseAdmin.from('purchase_orders')
            .insert({ po_no: poNo, vendor_id: parseInt(vendorId), status: '발주대기', total_amount: totalAmount, memo: '기존 결제완료 주문 마이그레이션' })
            .select('id').single();
          if (!newPO) continue;

          await supabaseAdmin.from('purchase_order_items').insert(
            poItemsList.map(i => ({
              purchase_order_id: newPO.id, product_id: i.product_id,
              product_name: i.product_name, color_name: i.color_name,
              size_name: i.size_name, qty: i.qty, cost_price: i.cost_price,
              subtotal: i.qty * i.cost_price,
            }))
          );
        }
      }
      processed++;
    } catch (e) { skipped++; }
  }

  return ok(res, { message: '마이그레이션 완료', total: orders.length, processed, skipped, adminFixed: true });
};
