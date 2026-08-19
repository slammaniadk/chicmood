const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { ok, fail, handleCors } = require('../_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const admin = requireAdmin(req, res, fail);
  if (!admin) return;

  // path 파싱: /api/admin/orders/123 → ['orders','123']
  // Vercel rewrite에서 path가 문자열로 올 수 있음
  let pathSegments = req.query.path || [];
  if (typeof pathSegments === 'string') {
    pathSegments = pathSegments.split('/').filter(Boolean);
  }
  const resource = pathSegments[0];
  const resourceId = pathSegments[1];

  switch (resource) {
    case 'stats':    return handleStats(req, res);
    case 'orders':   return resourceId ? handleOrderDetail(req, res, resourceId) : handleOrders(req, res);
    case 'products': return resourceId ? handleProductDetail(req, res, resourceId) : handleProducts(req, res);
    case 'broadcasts': return resourceId ? handleBroadcastDetail(req, res, resourceId) : handleBroadcasts(req, res);
    case 'shipping-excel': return handleShippingExcel(req, res);
    case 'members':  return resourceId ? handleMemberDetail(req, res, resourceId) : handleMembers(req, res);
    case 'vendors':  return resourceId ? handleVendorDetail(req, res, resourceId) : handleVendors(req, res);
    case 'purchase-orders': return resourceId ? handlePurchaseOrderDetail(req, res, resourceId) : handlePurchaseOrders(req, res);
    case 'sales':    return handleSales(req, res);
    case 'inventory': return resourceId ? handleInventoryDetail(req, res, resourceId) : handleInventory(req, res);
    case 'inventory-log': return handleInventoryLog(req, res);
    case 'returns':  return resourceId ? handleReturnDetail(req, res, resourceId) : handleReturns(req, res);
    case 'reports':  return handleReports(req, res);
    case 'settings': return handleSettings(req, res);
    case 'admin-users': return handleAdminUsers(req, res);
    case 'logs':     return handleLogs(req, res);
    default: return fail(res, 'Not found', 404);
  }
};

// ============================================================
//  STATS
// ============================================================
async function handleStats(req, res) {
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);

  const now = new Date();
  const thisYear = now.getFullYear(), thisMonth = now.getMonth(), thisDate = now.getDate();

  const [ordersRes, itemsRes, membersRes] = await Promise.all([
    supabaseAdmin.from('orders').select('status, total, created_at'),
    supabaseAdmin.from('order_items').select('name, qty, subtotal'),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }),
  ]);

  if (ordersRes.error) return fail(res, ordersRes.error.message, 500);

  const allOrders = ordersRes.data || [];
  const statusCounts = {}, statusTotals = {};
  let totalRevenue = 0, todayOrders = 0, todayRevenue = 0;
  let monthOrders = 0, monthRevenue = 0, yearOrders = 0, yearRevenue = 0;

  // Prep daily buckets (14 days)
  const dailySales = {};
  for (let i = 13; i >= 0; i--) {
    const dd = new Date(thisYear, thisMonth, thisDate - i);
    dailySales[`${String(dd.getMonth()+1).padStart(2,'0')}/${String(dd.getDate()).padStart(2,'0')}`] = { orders: 0, revenue: 0 };
  }
  // Prep monthly buckets (12 months)
  const monthlySales = {};
  for (let i = 11; i >= 0; i--) {
    const dd = new Date(thisYear, thisMonth - i, 1);
    monthlySales[`${dd.getFullYear()}.${String(dd.getMonth()+1).padStart(2,'0')}`] = { orders: 0, revenue: 0 };
  }
  const yearlySales = {};

  // Single pass
  allOrders.forEach(o => {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    statusTotals[o.status] = (statusTotals[o.status] || 0) + o.total;
    totalRevenue += o.total;
    const d = new Date(o.created_at);
    const y = d.getFullYear(), m = d.getMonth(), dt = d.getDate();
    if (y === thisYear) { yearOrders++; yearRevenue += o.total; if (m === thisMonth) { monthOrders++; monthRevenue += o.total; if (dt === thisDate) { todayOrders++; todayRevenue += o.total; } } }
    const dayKey = `${String(m+1).padStart(2,'0')}/${String(dt).padStart(2,'0')}`;
    if (dailySales[dayKey]) { dailySales[dayKey].orders++; dailySales[dayKey].revenue += o.total; }
    const mKey = `${y}.${String(m+1).padStart(2,'0')}`;
    if (monthlySales[mKey]) { monthlySales[mKey].orders++; monthlySales[mKey].revenue += o.total; }
    const yKey = `${y}`;
    if (!yearlySales[yKey]) yearlySales[yKey] = { orders: 0, revenue: 0 };
    yearlySales[yKey].orders++; yearlySales[yKey].revenue += o.total;
  });

  // Top products
  const productAgg = {};
  (itemsRes.data || []).forEach(item => {
    if (!productAgg[item.name]) productAgg[item.name] = { qty: 0, revenue: 0 };
    productAgg[item.name].qty += item.qty;
    productAgg[item.name].revenue += item.subtotal;
  });
  const topProducts = Object.entries(productAgg)
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return ok(res, {
    totalOrders: allOrders.length, totalRevenue,
    todayOrders, todayRevenue, monthOrders, monthRevenue, yearOrders, yearRevenue,
    statusCounts, statusTotals,
    dailySales, monthlySales, yearlySales,
    topProducts,
    totalMembers: membersRes.count || 0,
  });
}

// ============================================================
//  ORDERS LIST
// ============================================================
async function handleOrders(req, res) {
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);

  const { status, search, page = '1', limit = '20' } = req.query || {};
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  let query = supabaseAdmin
    .from('orders')
    .select('*, broadcasts:broadcast_id(id, title)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limitNum - 1);

  if (status && status !== 'all') query = query.eq('status', status);
  if (search) query = query.or(`name.ilike.%${search}%,order_no.ilike.%${search}%,phone.ilike.%${search}%`);

  let { data: orders, error, count } = await query;

  // broadcast_id 컬럼이 없으면 join 없이 재시도
  if (error && error.message && error.message.includes('broadcast_id')) {
    query = supabaseAdmin
      .from('orders')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);
    if (status && status !== 'all') query = query.eq('status', status);
    if (search) query = query.or(`name.ilike.%${search}%,order_no.ilike.%${search}%,phone.ilike.%${search}%`);
    ({ data: orders, error, count } = await query);
  }

  if (error) return fail(res, error.message, 500);

  const orderIds = orders.map(o => o.id);
  let items = [];
  if (orderIds.length > 0) {
    const { data: itemsData } = await supabaseAdmin.from('order_items').select('*').in('order_id', orderIds);
    items = itemsData || [];
  }

  // 거래처명 조회를 위해 product_id → vendor 매핑
  const productIds = [...new Set(items.filter(i => i.product_id).map(i => i.product_id))];
  let vendorMap = {};
  if (productIds.length > 0) {
    const { data: prods } = await supabaseAdmin.from('products').select('id, vendor_id, vendors(name)').in('id', productIds);
    (prods || []).forEach(p => {
      if (p.vendors) vendorMap[p.id] = p.vendors.name;
    });
  }

  const result = orders.map(o => ({
    id: o.id,
    orderNo: o.order_no,
    name: o.name,
    phone: o.phone,
    address: o.address,
    memo: o.memo,
    subtotal: o.subtotal,
    shippingFee: o.shipping_fee,
    total: o.total,
    status: o.status,
    trackingNo: o.tracking_no,
    trackingCarrier: o.tracking_carrier,
    broadcastId: o.broadcast_id || null,
    broadcastName: o.broadcasts ? o.broadcasts.title : '',
    createdAt: o.created_at,
    items: items.filter(i => i.order_id === o.id).map(i => ({
      name: i.name, color: i.color, size: i.size, qty: i.qty, price: i.price, subtotal: i.subtotal,
      vendorName: vendorMap[i.product_id] || '',
    })),
  }));

  return ok(res, { orders: result, total: count, page: pageNum, limit: limitNum });
}

// ============================================================
//  ORDER DETAIL (PATCH)
// ============================================================
async function handleOrderDetail(req, res, id) {
  // 주문 삭제
  if (req.method === 'DELETE') {
    const { data: order } = await supabaseAdmin.from('orders').select('id, status, broadcast_id').eq('id', id).single();
    if (!order) return fail(res, '주문을 찾을 수 없습니다', 404);
    // 결제완료 상태였으면 재고 복원 + 발주 차감
    if (order.status === '결제완료') {
      await deductInventory(id, 'cancel');
      await deductPurchaseOrderQty(id);
    }
    await supabaseAdmin.from('order_items').delete().eq('order_id', id);
    const { error } = await supabaseAdmin.from('orders').delete().eq('id', id);
    if (error) return fail(res, error.message, 500);
    return ok(res, { deleted: true });
  }

  if (req.method !== 'PATCH') return fail(res, 'Method not allowed', 405);

  const { status, trackingNo, trackingCarrier } = req.body;
  const validStatuses = ['입금대기', '확인요청', '결제완료', '배송중', '송장완료', '취소'];
  if (status && !validStatuses.includes(status)) return fail(res, `유효하지 않은 상태입니다: ${status}`);

  // 결제완료 전환 시 기존 상태 확인 (중복 차감 방지)
  let prevStatus = null;
  if (status === '결제완료' || status === '취소') {
    const { data: prev } = await supabaseAdmin.from('orders').select('status').eq('id', id).single();
    if (prev) prevStatus = prev.status;
  }

  const update = {};
  if (status) update.status = status;
  if (trackingNo !== undefined) update.tracking_no = trackingNo;
  if (trackingCarrier !== undefined) update.tracking_carrier = trackingCarrier;

  if (Object.keys(update).length === 0) return fail(res, '변경할 내용이 없습니다');

  const { data, error } = await supabaseAdmin
    .from('orders')
    .update(update)
    .eq('id', id)
    .select('id, order_no, status, tracking_no, tracking_carrier')
    .single();

  if (error) return fail(res, error.message, 500);
  if (!data) return fail(res, '주문을 찾을 수 없습니다', 404);

  // 결제완료 전환 시 재고 자동 차감 + 자동 발주 생성
  if (status === '결제완료' && prevStatus && prevStatus !== '결제완료') {
    await deductInventory(id, 'sale');
    await createAutoPurchaseOrders(id);
  }
  // 결제완료에서 다른 상태로 변경 시 재고 복원 + 발주 수량 차감
  if (prevStatus === '결제완료' && status !== '결제완료') {
    await deductInventory(id, 'cancel');
    await deductPurchaseOrderQty(id);
  }

  return ok(res, { id: data.id, orderNo: data.order_no, status: data.status, trackingNo: data.tracking_no, trackingCarrier: data.tracking_carrier });
}

// 재고 차감/복원 헬퍼
async function deductInventory(orderId, action) {
  try {
    const { data: items } = await supabaseAdmin.from('order_items')
      .select('product_id, color, size, qty').eq('order_id', orderId);
    if (!items || items.length === 0) return;

    for (const item of items) {
      const { data: inv } = await supabaseAdmin.from('inventory')
        .select('id, stock_qty')
        .eq('product_id', item.product_id)
        .eq('color_name', item.color || '')
        .eq('size_name', item.size || '')
        .single();

      if (inv) {
        const diff = action === 'sale' ? -item.qty : item.qty;
        const newQty = Math.max(0, inv.stock_qty + diff);
        await supabaseAdmin.from('inventory').update({ stock_qty: newQty, updated_at: new Date().toISOString() }).eq('id', inv.id);
        await supabaseAdmin.from('inventory_log').insert({
          inventory_id: inv.id, product_id: item.product_id,
          type: action === 'sale' ? 'sale' : 'in',
          qty: diff,
          reason: action === 'sale' ? '주문 결제완료 자동 차감' : '주문 취소 재고 복원',
        });
      }
    }
  } catch (e) { /* 재고 차감 실패해도 주문 처리는 유지 */ }
}

// 주문 취소/삭제 시 발주 수량 차감 헬퍼
async function deductPurchaseOrderQty(orderId) {
  try {
    // 주문의 방송 정보 조회
    const { data: order } = await supabaseAdmin.from('orders')
      .select('broadcast_id').eq('id', orderId).single();

    // 주문 품목 조회
    const { data: items } = await supabaseAdmin.from('order_items')
      .select('product_id, color, size, qty').eq('order_id', orderId);
    if (!items || items.length === 0) return;

    // 상품의 vendor_id 조회
    const productIds = [...new Set(items.map(i => i.product_id).filter(Boolean))];
    if (productIds.length === 0) return;
    const { data: products } = await supabaseAdmin.from('products')
      .select('id, vendor_id').in('id', productIds);
    const vendorMap = {};
    (products || []).forEach(p => { vendorMap[p.id] = p.vendor_id; });

    // 발주대기 상태의 발주서에서 해당 품목 수량 차감
    for (const item of items) {
      if (!item.product_id) continue;
      const vendorId = vendorMap[item.product_id];
      if (!vendorId) continue;

      // 해당 거래처의 발주대기 발주서 찾기
      let query = supabaseAdmin.from('purchase_orders')
        .select('id').eq('vendor_id', vendorId).eq('status', '발주대기');
      if (order && order.broadcast_id) {
        query = query.eq('broadcast_id', order.broadcast_id);
      }
      const { data: pos } = await query;
      if (!pos || pos.length === 0) continue;

      for (const po of pos) {
        const { data: poItem } = await supabaseAdmin.from('purchase_order_items')
          .select('id, qty, cost_price')
          .eq('purchase_order_id', po.id)
          .eq('product_id', item.product_id)
          .eq('color_name', item.color || '')
          .eq('size_name', item.size || '')
          .single();

        if (poItem) {
          const newQty = poItem.qty - item.qty;
          if (newQty <= 0) {
            // 수량이 0 이하면 품목 삭제
            await supabaseAdmin.from('purchase_order_items').delete().eq('id', poItem.id);
          } else {
            await supabaseAdmin.from('purchase_order_items')
              .update({ qty: newQty, subtotal: newQty * poItem.cost_price }).eq('id', poItem.id);
          }

          // 남은 품목 확인 후 발주서 total 재계산 또는 삭제
          const { data: remaining } = await supabaseAdmin.from('purchase_order_items')
            .select('subtotal').eq('purchase_order_id', po.id);
          if (!remaining || remaining.length === 0) {
            // 품목이 모두 없어지면 발주서 삭제
            await supabaseAdmin.from('purchase_orders').delete().eq('id', po.id);
          } else {
            const newTotal = remaining.reduce((s, i) => s + (i.subtotal || 0), 0);
            await supabaseAdmin.from('purchase_orders').update({
              total_amount: newTotal, updated_at: new Date().toISOString()
            }).eq('id', po.id);
          }
          break; // 해당 품목은 처리 완료
        }
      }
    }
  } catch (e) { /* 발주 차감 실패해도 주문 처리는 유지 */ }
}

// 자동 발주 생성 헬퍼 (결제완료 시 거래처+방송 단위로 발주서 자동 생성/합산)
async function createAutoPurchaseOrders(orderId) {
  try {
    // 0) 주문의 broadcast_id 직접 조회
    let orderBroadcastId = null;
    let orderBroadcastTitle = '';
    try {
      const { data: orderData } = await supabaseAdmin.from('orders')
        .select('broadcast_id, broadcasts:broadcast_id(id, title)').eq('id', orderId).single();
      if (orderData && orderData.broadcast_id) {
        orderBroadcastId = orderData.broadcast_id;
        orderBroadcastTitle = orderData.broadcasts ? orderData.broadcasts.title : '';
      }
    } catch (e) { /* broadcast_id 컬럼 없으면 무시 */ }

    // 1) 주문 품목 조회
    const { data: items } = await supabaseAdmin.from('order_items')
      .select('product_id, name, color, size, qty').eq('order_id', orderId);
    if (!items || items.length === 0) return;

    // product_id 없는 품목은 상품명으로 매칭 시도
    for (const item of items) {
      if (!item.product_id && item.name) {
        const { data: matched } = await supabaseAdmin.from('products')
          .select('id').ilike('name', `%${item.name}%`).limit(1).single();
        if (matched) item.product_id = matched.id;
      }
    }

    const validItems = items.filter(i => i.product_id);
    if (validItems.length === 0) return;

    // 2) 상품 정보 조회 (vendor_id, cost_price, wholesale_price, name)
    const productIds = [...new Set(validItems.map(i => i.product_id))];
    const { data: products } = await supabaseAdmin.from('products')
      .select('id, name, vendor_id, cost_price, wholesale_price').in('id', productIds);
    if (!products || products.length === 0) return;

    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });

    // 3) 방송 정보: 주문에 broadcast_id가 있으면 그걸 사용, 없으면 product→broadcast 간접 매핑
    let productBroadcastMap = {};
    if (orderBroadcastId) {
      // 주문에 직접 연결된 방송 사용
      productIds.forEach(pid => {
        productBroadcastMap[pid] = { broadcastId: orderBroadcastId, broadcastTitle: orderBroadcastTitle };
      });
    } else {
      // fallback: product_id → broadcast_products → broadcast (간접 매핑)
      const { data: bcProducts } = await supabaseAdmin.from('broadcast_products')
        .select('product_id, broadcast_id, broadcasts(id, title)')
        .in('product_id', productIds)
        .order('broadcast_id', { ascending: false });
      (bcProducts || []).forEach(bp => {
        if (!productBroadcastMap[bp.product_id]) {
          productBroadcastMap[bp.product_id] = {
            broadcastId: bp.broadcast_id,
            broadcastTitle: bp.broadcasts ? bp.broadcasts.title : '',
          };
        }
      });
    }

    // 4) (vendor_id, broadcast_id) 기준 그룹핑
    const groups = {};
    for (const item of validItems) {
      const prod = productMap[item.product_id];
      if (!prod || !prod.vendor_id) continue;
      const bc = productBroadcastMap[item.product_id] || { broadcastId: 0, broadcastTitle: '' };
      const groupKey = `${prod.vendor_id}_${bc.broadcastId}`;
      if (!groups[groupKey]) {
        groups[groupKey] = { vendorId: prod.vendor_id, broadcastId: bc.broadcastId, broadcastTitle: bc.broadcastTitle, items: [] };
      }
      groups[groupKey].items.push({
        product_id: item.product_id,
        product_name: item.name || prod.name,
        color_name: item.color || '',
        size_name: item.size || '',
        qty: item.qty,
        cost_price: prod.wholesale_price || prod.cost_price || 0,
      });
    }

    // 5) 거래처+방송별 발주서 생성 또는 기존 발주대기 발주서에 합산
    for (const group of Object.values(groups)) {
      const memoText = group.broadcastTitle || '';

      // 기존 '발주대기' 발주서 확인 (동일 거래처 + 동일 방송)
      let existingPO = null;
      let query = supabaseAdmin.from('purchase_orders')
        .select('id, memo').eq('vendor_id', group.vendorId).eq('status', '발주대기');
      if (group.broadcastId) {
        query = query.eq('broadcast_id', group.broadcastId);
      }
      const { data: candidatePOs } = await query.order('id', { ascending: false }).limit(1);
      if (candidatePOs && candidatePOs.length > 0) existingPO = candidatePOs[0];

      let poId;
      if (existingPO) {
        poId = existingPO.id;
        const { data: existingItems } = await supabaseAdmin.from('purchase_order_items')
          .select('id, product_id, product_name, color_name, size_name, qty, cost_price')
          .eq('purchase_order_id', poId);

        for (const newItem of group.items) {
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
        // 새 발주서 생성
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
        const { count } = await supabaseAdmin.from('purchase_orders')
          .select('id', { count: 'exact', head: true }).ilike('po_no', `PO-${dateStr}%`);
        const poNo = `PO-${dateStr}-${String((count || 0) + 1).padStart(3, '0')}`;

        const totalAmount = group.items.reduce((s, i) => s + i.qty * i.cost_price, 0);
        const insertData = { po_no: poNo, vendor_id: group.vendorId, status: '발주대기', total_amount: totalAmount, memo: memoText };
        if (group.broadcastId) insertData.broadcast_id = group.broadcastId;
        let newPO;
        ({ data: newPO } = await supabaseAdmin.from('purchase_orders')
          .insert(insertData).select('id').single());
        // broadcast_id 컬럼 미존재 시 fallback
        if (!newPO && group.broadcastId) {
          delete insertData.broadcast_id;
          ({ data: newPO } = await supabaseAdmin.from('purchase_orders')
            .insert(insertData).select('id').single());
        }
        if (!newPO) continue;
        poId = newPO.id;

        await supabaseAdmin.from('purchase_order_items').insert(
          group.items.map(i => ({
            purchase_order_id: poId, product_id: i.product_id,
            product_name: i.product_name, color_name: i.color_name,
            size_name: i.size_name, qty: i.qty, cost_price: i.cost_price,
            subtotal: i.qty * i.cost_price,
          }))
        );
      }
    }
  } catch (e) { /* 자동 발주 생성 실패해도 주문 처리는 유지 */ }
}

// ============================================================
//  PRODUCTS LIST / CREATE
// ============================================================
async function handleProducts(req, res) {
  if (req.method === 'GET') {
    const { data: products, error } = await supabaseAdmin
      .from('products')
      .select('*, product_images(*), product_colors(*), vendors(name)')
      .order('id', { ascending: false });

    if (error) return fail(res, error.message, 500);

    const result = products.map(p => ({
      id: p.id,
      name: p.name,
      price: p.price,
      originalPrice: p.original_price,
      discount: p.discount,
      description: p.description,
      material: p.material,
      vendorId: p.vendor_id,
      vendorName: p.vendors ? p.vendors.name : '',
      costPrice: p.cost_price || 0,
      wholesalePrice: p.wholesale_price || 0,
      size: p.size || '',
      images: (p.product_images || []).sort((a, b) => a.sort_order - b.sort_order).map(img => img.image_url),
      colors: (p.product_colors || []).sort((a, b) => a.sort_order - b.sort_order).map(c => ({ name: c.name, hex: c.hex_code })),
    }));

    return ok(res, result);
  }

  if (req.method === 'POST') {
    const { name, price, originalPrice, discount, description, material, images, colors, vendorId, costPrice, wholesalePrice, size } = req.body;
    if (!name) return fail(res, '상품명은 필수입니다');

    const finalPrice = price || costPrice || 0;
    const insertData = { name, price: finalPrice, original_price: originalPrice || finalPrice, discount: discount || 0, description: description || '', material: material || '', size: size || '' };
    if (vendorId) insertData.vendor_id = vendorId;
    if (costPrice) insertData.cost_price = costPrice;
    if (wholesalePrice !== undefined) insertData.wholesale_price = wholesalePrice;

    const { data: product, error } = await supabaseAdmin
      .from('products')
      .insert(insertData)
      .select('id')
      .single();

    if (error) return fail(res, error.message, 500);

    if (images && images.length > 0) {
      await supabaseAdmin.from('product_images').insert(images.map((url, i) => ({ product_id: product.id, image_url: url, sort_order: i })));
    }
    if (colors && colors.length > 0) {
      await supabaseAdmin.from('product_colors').insert(colors.map((c, i) => ({ product_id: product.id, name: c.name, hex_code: c.hex, sort_order: i })));
    }

    return ok(res, { id: product.id }, 201);
  }

  return fail(res, 'Method not allowed', 405);
}

// ============================================================
//  PRODUCT DETAIL (PATCH / DELETE)
// ============================================================
async function handleProductDetail(req, res, id) {
  if (req.method === 'PATCH') {
    const { name, price, originalPrice, discount, description, material, images, colors, vendorId, costPrice, wholesalePrice, size } = req.body;

    const update = {};
    if (name !== undefined) update.name = name;
    if (price !== undefined) update.price = price;
    if (originalPrice !== undefined) update.original_price = originalPrice;
    if (discount !== undefined) update.discount = discount;
    if (description !== undefined) update.description = description;
    if (material !== undefined) update.material = material;
    if (vendorId !== undefined) update.vendor_id = vendorId;
    if (costPrice !== undefined) update.cost_price = costPrice;
    if (wholesalePrice !== undefined) update.wholesale_price = wholesalePrice;
    if (size !== undefined) update.size = size;

    if (Object.keys(update).length > 0) {
      const { error } = await supabaseAdmin.from('products').update(update).eq('id', id);
      if (error) return fail(res, error.message, 500);
    }

    if (images) {
      await supabaseAdmin.from('product_images').delete().eq('product_id', id);
      if (images.length > 0) {
        await supabaseAdmin.from('product_images').insert(images.map((url, i) => ({ product_id: parseInt(id), image_url: url, sort_order: i })));
      }
    }

    if (colors) {
      await supabaseAdmin.from('product_colors').delete().eq('product_id', id);
      if (colors.length > 0) {
        await supabaseAdmin.from('product_colors').insert(colors.map((c, i) => ({ product_id: parseInt(id), name: c.name, hex_code: c.hex, sort_order: i })));
      }
    }

    return ok(res, { id: parseInt(id) });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabaseAdmin.from('products').delete().eq('id', id);
    if (error) return fail(res, error.message, 500);
    return ok(res, { deleted: true });
  }

  return fail(res, 'Method not allowed', 405);
}

// ============================================================
//  BROADCASTS LIST / CREATE
// ============================================================
async function handleBroadcasts(req, res) {
  if (req.method === 'GET') {
    const { search, status: filterStatus } = req.query || {};
    let query = supabaseAdmin
      .from('broadcasts')
      .select('*, broadcast_products(product_id)')
      .order('id', { ascending: false });

    if (filterStatus && filterStatus !== 'all') query = query.eq('status', filterStatus);
    if (search) query = query.ilike('title', `%${search}%`);

    const { data: broadcasts, error } = await query;
    if (error) return fail(res, error.message, 500);

    const result = broadcasts.map(b => ({
      id: b.id,
      title: b.title,
      date: b.date_text,
      scheduledAt: b.scheduled_at,
      status: b.status,
      description: b.description,
      productIds: (b.broadcast_products || []).map(bp => bp.product_id),
    }));

    return ok(res, result);
  }

  if (req.method === 'POST') {
    const { title, date, scheduledAt, status, description, productIds } = req.body;
    if (!title) return fail(res, '방송 제목은 필수입니다');

    const { data: broadcast, error } = await supabaseAdmin
      .from('broadcasts')
      .insert({ title, date_text: date || '', scheduled_at: scheduledAt || null, status: status || 'live', description: description || '' })
      .select('id')
      .single();

    if (error) return fail(res, error.message, 500);

    if (productIds && productIds.length > 0) {
      await supabaseAdmin.from('broadcast_products').insert(productIds.map((pid, i) => ({ broadcast_id: broadcast.id, product_id: pid, sort_order: i })));
    }

    return ok(res, { id: broadcast.id }, 201);
  }

  return fail(res, 'Method not allowed', 405);
}

// ============================================================
//  BROADCAST DETAIL (PATCH / DELETE)
// ============================================================
async function handleBroadcastDetail(req, res, id) {
  if (req.method === 'GET') {
    const { data: b, error } = await supabaseAdmin
      .from('broadcasts')
      .select('*, broadcast_products(product_id, products(id, name, price))')
      .eq('id', id).single();
    if (error || !b) return fail(res, '방송을 찾을 수 없습니다', 404);

    // 방송 연결 상품의 매출 계산
    const productIds = (b.broadcast_products || []).map(bp => bp.product_id);
    let salesData = { orderCount: 0, revenue: 0, qty: 0 };
    if (productIds.length > 0) {
      const { data: allOrders } = await supabaseAdmin.from('orders').select('id').neq('status', '취소');
      const orderIds = (allOrders || []).map(o => o.id);
      if (orderIds.length > 0) {
        const { data: items } = await supabaseAdmin.from('order_items').select('product_id, qty, subtotal').in('order_id', orderIds).in('product_id', productIds);
        (items || []).forEach(i => { salesData.orderCount++; salesData.revenue += i.subtotal; salesData.qty += i.qty; });
      }
    }

    const products = (b.broadcast_products || []).map(bp => ({
      id: bp.products?.id, name: bp.products?.name || '', price: bp.products?.price || 0,
    }));

    return ok(res, {
      broadcast: {
        id: b.id, title: b.title, date: b.date_text, status: b.status,
        description: b.description, createdAt: b.created_at,
        products, sales: salesData,
      }
    });
  }

  if (req.method === 'PATCH') {
    const { title, date, scheduledAt, status, description, productIds } = req.body;

    const update = {};
    if (title !== undefined) update.title = title;
    if (date !== undefined) update.date_text = date;
    if (scheduledAt !== undefined) update.scheduled_at = scheduledAt;
    if (status !== undefined) update.status = status;
    if (description !== undefined) update.description = description;

    if (Object.keys(update).length > 0) {
      const { error } = await supabaseAdmin.from('broadcasts').update(update).eq('id', id);
      if (error) return fail(res, error.message, 500);
    }

    if (productIds) {
      await supabaseAdmin.from('broadcast_products').delete().eq('broadcast_id', id);
      if (productIds.length > 0) {
        await supabaseAdmin.from('broadcast_products').insert(productIds.map((pid, i) => ({ broadcast_id: parseInt(id), product_id: pid, sort_order: i })));
      }
    }

    return ok(res, { id: parseInt(id) });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabaseAdmin.from('broadcasts').delete().eq('id', id);
    if (error) return fail(res, error.message, 500);
    return ok(res, { deleted: true });
  }

  return fail(res, 'Method not allowed', 405);
}

// ============================================================
//  SHIPPING EXCEL (로젠택배 엑셀 데이터)
// ============================================================
async function handleShippingExcel(req, res) {
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);
  const { orderIds } = req.body;
  if (!orderIds || orderIds.length === 0) return fail(res, '주문을 선택해주세요');

  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select('*')
    .in('id', orderIds);
  if (error) return fail(res, error.message, 500);

  const oIds = orders.map(o => o.id);
  let items = [];
  if (oIds.length > 0) {
    const { data: itemsData } = await supabaseAdmin.from('order_items').select('*').in('order_id', oIds);
    items = itemsData || [];
  }

  // 로젠택배 형식 행 생성
  const rows = orders.map(o => {
    const orderItems = items.filter(i => i.order_id === o.id);
    const productDetail = orderItems.map(i => `${i.name}(${i.color||''}/${i.size||''})x${i.qty}`).join(', ');
    const totalQty = orderItems.reduce((s, i) => s + i.qty, 0);
    return [
      o.name,             // 수취인명
      '',                 // (빈)
      o.address || '',    // 주소
      o.phone || '',      // 전화번호1
      o.phone || '',      // 전화번호2
      totalQty || 1,      // 수량
      2800,               // 배송비
      '010',              // 코드
      productDetail,      // 상품상세
      '',                 // (빈)
      o.memo || '',       // 배송메모
    ];
  });

  return ok(res, { rows });
}

// ============================================================
//  MEMBERS (회원관리)
// ============================================================
async function handleMembers(req, res) {
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);

  const { search, page = '1', limit = '20' } = req.query || {};
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  let query = supabaseAdmin
    .from('users')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limitNum - 1);

  if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);

  const { data: users, error, count } = await query;
  if (error) return fail(res, error.message, 500);

  // 각 회원의 주문 통계 집계
  const userIds = users.map(u => u.id);
  let orderStats = {};
  if (userIds.length > 0) {
    const { data: orders } = await supabaseAdmin.from('orders').select('user_id, total, created_at').in('user_id', userIds);
    (orders || []).forEach(o => {
      if (!orderStats[o.user_id]) orderStats[o.user_id] = { count: 0, total: 0, lastOrderAt: null };
      orderStats[o.user_id].count++;
      orderStats[o.user_id].total += o.total;
      if (!orderStats[o.user_id].lastOrderAt || o.created_at > orderStats[o.user_id].lastOrderAt) {
        orderStats[o.user_id].lastOrderAt = o.created_at;
      }
    });
  }

  const members = users.map(u => {
    const stats = orderStats[u.id] || { count: 0, total: 0, lastOrderAt: null };
    return {
      id: u.id,
      name: u.name,
      phone: u.phone,
      role: u.role,
      orderCount: stats.count,
      totalSpent: stats.total,
      avgOrder: stats.count > 0 ? Math.round(stats.total / stats.count) : 0,
      lastOrderAt: stats.lastOrderAt,
      createdAt: u.created_at,
    };
  });

  return ok(res, { members, total: count, page: pageNum, limit: limitNum });
}

async function handleMemberDetail(req, res, id) {
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);

  const { data: user, error } = await supabaseAdmin.from('users').select('*').eq('id', id).single();
  if (error || !user) return fail(res, '회원을 찾을 수 없습니다', 404);

  const { data: orders } = await supabaseAdmin
    .from('orders')
    .select('id, order_no, total, status, created_at')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .limit(50);

  return ok(res, {
    member: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      createdAt: user.created_at,
      orders: (orders || []).map(o => ({
        id: o.id, orderNo: o.order_no, total: o.total, status: o.status, createdAt: o.created_at,
      })),
    }
  });
}

// ============================================================
//  VENDORS (거래처관리)
// ============================================================
async function handleVendors(req, res) {
  if (req.method === 'GET') {
    const { search, isActive } = req.query || {};

    let query = supabaseAdmin
      .from('vendors')
      .select('*')
      .order('id', { ascending: false });

    if (isActive === 'true') query = query.eq('is_active', true);
    else if (isActive === 'false') query = query.eq('is_active', false);

    if (search) query = query.or(`name.ilike.%${search}%,contact.ilike.%${search}%,phone.ilike.%${search}%`);

    const { data: vendors, error } = await query;
    if (error) return fail(res, error.message, 500);

    // 거래처별 상품 수 집계
    const vendorIds = vendors.map(v => v.id);
    let productCounts = {};
    if (vendorIds.length > 0) {
      const { data: products } = await supabaseAdmin.from('products').select('vendor_id').in('vendor_id', vendorIds);
      (products || []).forEach(p => {
        productCounts[p.vendor_id] = (productCounts[p.vendor_id] || 0) + 1;
      });
    }

    const result = vendors.map(v => ({
      id: v.id, name: v.name, contact: v.contact, phone: v.phone,
      email: v.email, address: v.address, bankInfo: v.bank_info,
      memo: v.memo, isActive: v.is_active, productCount: productCounts[v.id] || 0,
    }));
    return ok(res, result);
  }

  if (req.method === 'POST') {
    const { name, contact, phone, email, address, bankInfo, memo } = req.body;
    if (!name) return fail(res, '거래처명은 필수입니다');
    const { data, error } = await supabaseAdmin.from('vendors')
      .insert({ name, contact: contact||'', phone: phone||'', email: email||'', address: address||'', bank_info: bankInfo||'', memo: memo||'' })
      .select('id').single();
    if (error) return fail(res, error.message, 500);
    return ok(res, { id: data.id }, 201);
  }

  return fail(res, 'Method not allowed', 405);
}

async function handleVendorDetail(req, res, id) {
  if (req.method === 'GET') {
    const { data: vendor, error } = await supabaseAdmin.from('vendors').select('*').eq('id', id).single();
    if (error || !vendor) return fail(res, '거래처를 찾을 수 없습니다', 404);

    // 연결된 상품 목록
    const { data: products } = await supabaseAdmin
      .from('products')
      .select('id, name, price, cost_price, product_images(image_url, sort_order)')
      .eq('vendor_id', id)
      .order('id', { ascending: false });

    // 발주 내역
    const { data: purchaseOrders } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, po_no, status, total_amount, ordered_at, created_at')
      .eq('vendor_id', id)
      .order('id', { ascending: false })
      .limit(20);

    return ok(res, {
      vendor: {
        id: vendor.id, name: vendor.name, contact: vendor.contact, phone: vendor.phone,
        email: vendor.email, address: vendor.address, bankInfo: vendor.bank_info,
        memo: vendor.memo, isActive: vendor.is_active, createdAt: vendor.created_at,
      },
      products: (products || []).map(p => ({
        id: p.id, name: p.name, price: p.price, costPrice: p.cost_price || 0,
        image: (p.product_images || []).sort((a, b) => a.sort_order - b.sort_order)[0]?.image_url || '',
      })),
      purchaseOrders: (purchaseOrders || []).map(po => ({
        id: po.id, poNo: po.po_no, status: po.status,
        totalAmount: po.total_amount, orderedAt: po.ordered_at, createdAt: po.created_at,
      })),
    });
  }

  if (req.method === 'PATCH') {
    const { name, contact, phone, email, address, bankInfo, memo, isActive } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (contact !== undefined) update.contact = contact;
    if (phone !== undefined) update.phone = phone;
    if (email !== undefined) update.email = email;
    if (address !== undefined) update.address = address;
    if (bankInfo !== undefined) update.bank_info = bankInfo;
    if (memo !== undefined) update.memo = memo;
    if (isActive !== undefined) update.is_active = isActive;

    if (Object.keys(update).length === 0) return fail(res, '변경할 내용이 없습니다');
    const { error } = await supabaseAdmin.from('vendors').update(update).eq('id', id);
    if (error) return fail(res, error.message, 500);
    return ok(res, { id: parseInt(id) });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabaseAdmin.from('vendors').delete().eq('id', id);
    if (error) return fail(res, error.message, 500);
    return ok(res, { deleted: true });
  }

  return fail(res, 'Method not allowed', 405);
}

// ============================================================
//  PURCHASE ORDERS (발주관리)
// ============================================================
async function handlePurchaseOrders(req, res) {
  if (req.method === 'GET') {
    const { status, search, page = '1', limit = '20' } = req.query || {};
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabaseAdmin
      .from('purchase_orders')
      .select('*, vendors(name)', { count: 'exact' })
      .order('id', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (status && status !== 'all') query = query.eq('status', status);
    if (search) query = query.ilike('po_no', `%${search}%`);

    const { data, error, count } = await query;
    if (error) return fail(res, error.message, 500);

    // search가 거래처명일 수 있으므로 클라이언트에서 필터 (po_no로 못찾으면 vendor name 매칭)
    let filtered = data || [];
    if (search && filtered.length === 0) {
      // po_no 매칭 실패 시 vendor name으로 재검색
      const retryQuery = supabaseAdmin
        .from('purchase_orders')
        .select('*, vendors!inner(name)', { count: 'exact' })
        .ilike('vendors.name', `%${search}%`)
        .order('id', { ascending: false })
        .range(offset, offset + limitNum - 1);
      if (status && status !== 'all') retryQuery.eq('status', status);
      const retry = await retryQuery;
      if (!retry.error) { filtered = retry.data || []; }
    }

    const result = filtered.map(po => ({
      id: po.id, poNo: po.po_no, vendorId: po.vendor_id,
      vendorName: po.vendors ? po.vendors.name : '', status: po.status,
      totalAmount: po.total_amount, memo: po.memo,
      orderedAt: po.ordered_at, expectedAt: po.expected_at,
      completedAt: po.completed_at, createdAt: po.created_at,
    }));
    return ok(res, { purchaseOrders: result, total: count, page: pageNum, limit: limitNum });
  }

  if (req.method === 'POST') {
    const { vendorId, memo, items } = req.body;
    if (!vendorId) return fail(res, '거래처를 선택해주세요');
    if (!items || items.length === 0) return fail(res, '품목을 입력해주세요');

    // 발주번호 생성
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const { count } = await supabaseAdmin.from('purchase_orders').select('id', { count: 'exact', head: true }).ilike('po_no', `PO-${dateStr}%`);
    const poNo = `PO-${dateStr}-${String((count || 0) + 1).padStart(3, '0')}`;

    const totalAmount = items.reduce((s, i) => s + (i.qty || 1) * (i.costPrice || 0), 0);

    const { data: po, error } = await supabaseAdmin.from('purchase_orders')
      .insert({ po_no: poNo, vendor_id: vendorId, status: '발주대기', total_amount: totalAmount, memo: memo || '' })
      .select('id').single();
    if (error) return fail(res, error.message, 500);

    const poItems = items.map(i => ({
      purchase_order_id: po.id,
      product_id: i.productId || null,
      product_name: i.productName || '',
      color_name: i.colorName || '',
      size_name: i.sizeName || '',
      qty: i.qty || 1,
      cost_price: i.costPrice || 0,
      subtotal: (i.qty || 1) * (i.costPrice || 0),
    }));
    await supabaseAdmin.from('purchase_order_items').insert(poItems);

    return ok(res, { id: po.id, poNo }, 201);
  }

  return fail(res, 'Method not allowed', 405);
}

async function handlePurchaseOrderDetail(req, res, id) {
  if (req.method === 'GET') {
    const { data: po, error } = await supabaseAdmin
      .from('purchase_orders')
      .select('*, vendors(name), purchase_order_items(*)')
      .eq('id', id).single();
    if (error || !po) return fail(res, '발주서를 찾을 수 없습니다', 404);

    return ok(res, {
      purchaseOrder: {
        id: po.id, poNo: po.po_no, vendorId: po.vendor_id,
        vendorName: po.vendors ? po.vendors.name : '', status: po.status,
        totalAmount: po.total_amount, memo: po.memo,
        orderedAt: po.ordered_at, createdAt: po.created_at,
        items: (po.purchase_order_items || []).map(i => ({
          id: i.id, productId: i.product_id, productName: i.product_name, colorName: i.color_name,
          sizeName: i.size_name, qty: i.qty, costPrice: i.cost_price, subtotal: i.subtotal,
        })),
      }
    });
  }

  if (req.method === 'PATCH') {
    const { status, memo, items } = req.body;
    const update = {};
    if (status) {
      update.status = status;
      if (status === '발주완료') update.ordered_at = new Date().toISOString();
      if (status === '입고완료') update.completed_at = new Date().toISOString();
    }
    if (memo !== undefined) update.memo = memo;
    update.updated_at = new Date().toISOString();

    // items 배열이 전달되면 기존 품목 삭제 후 새로 삽입
    if (items && Array.isArray(items)) {
      await supabaseAdmin.from('purchase_order_items').delete().eq('purchase_order_id', id);
      if (items.length > 0) {
        const poItems = items.map(i => ({
          purchase_order_id: parseInt(id),
          product_id: i.productId || null,
          product_name: i.productName || '',
          color_name: i.colorName || '',
          size_name: i.sizeName || '',
          qty: i.qty || 1,
          cost_price: i.costPrice || 0,
          subtotal: (i.qty || 1) * (i.costPrice || 0),
        }));
        await supabaseAdmin.from('purchase_order_items').insert(poItems);
      }
      // total_amount 재계산
      update.total_amount = items.reduce((s, i) => s + (i.qty || 1) * (i.costPrice || 0), 0);
    }

    const { error } = await supabaseAdmin.from('purchase_orders').update(update).eq('id', id);
    if (error) return fail(res, error.message, 500);
    return ok(res, { id: parseInt(id) });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabaseAdmin.from('purchase_orders').delete().eq('id', id);
    if (error) return fail(res, error.message, 500);
    return ok(res, { deleted: true });
  }

  return fail(res, 'Method not allowed', 405);
}

// ============================================================
//  SALES (매출관리)
// ============================================================
async function handleSales(req, res) {
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);

  const { type = 'daily', from, to, search } = req.query || {};

  let query = supabaseAdmin.from('orders').select('id, total, status, created_at');
  query = query.neq('status', '취소');
  if (from) query = query.gte('created_at', from + 'T00:00:00');
  if (to) query = query.lte('created_at', to + 'T23:59:59');

  const { data: orders, error } = await query.order('created_at', { ascending: false });
  if (error) return fail(res, error.message, 500);

  const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
  const orderCount = orders.length;
  const avgOrder = orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0;

  // 이전 기간 비교 (from/to 모두 설정 시)
  let prevRevenue = null, prevOrderCount = null;
  if (from && to) {
    const fromDate = new Date(from + 'T00:00:00');
    const toDate = new Date(to + 'T23:59:59');
    const duration = toDate - fromDate;
    const prevToDate = new Date(fromDate.getTime() - 1);
    const prevFromDate = new Date(prevToDate.getTime() - duration);
    const prevFromStr = prevFromDate.toISOString().split('T')[0];
    const prevToStr = prevToDate.toISOString().split('T')[0];
    const { data: prevOrders } = await supabaseAdmin.from('orders')
      .select('total').neq('status', '취소')
      .gte('created_at', prevFromStr + 'T00:00:00')
      .lte('created_at', prevToStr + 'T23:59:59');
    prevRevenue = (prevOrders || []).reduce((s, o) => s + o.total, 0);
    prevOrderCount = (prevOrders || []).length;
  }

  const summary = { totalRevenue, orderCount, avgOrder, prevRevenue, prevOrderCount };

  let rows = [];

  if (type === 'daily') {
    const grouped = {};
    orders.forEach(o => {
      const d = new Date(o.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (!grouped[key]) grouped[key] = { orderCount: 0, revenue: 0 };
      grouped[key].orderCount++;
      grouped[key].revenue += o.total;
    });
    rows = Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0])).map(([period, v]) => ({ period, ...v }));
  } else if (type === 'monthly') {
    const grouped = {};
    orders.forEach(o => {
      const d = new Date(o.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if (!grouped[key]) grouped[key] = { orderCount: 0, revenue: 0 };
      grouped[key].orderCount++;
      grouped[key].revenue += o.total;
    });
    rows = Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0])).map(([period, v]) => ({ period, ...v }));
  } else if (type === 'product') {
    const orderIds = orders.map(o => o.id);
    let items = [];
    if (orderIds.length > 0) {
      const { data: itemsData } = await supabaseAdmin.from('order_items').select('name, qty, subtotal').in('order_id', orderIds);
      items = itemsData || [];
    }
    const grouped = {};
    items.forEach(i => {
      if (!grouped[i.name]) grouped[i.name] = { totalQty: 0, revenue: 0 };
      grouped[i.name].totalQty += i.qty;
      grouped[i.name].revenue += i.subtotal;
    });
    rows = Object.entries(grouped).sort((a, b) => b[1].revenue - a[1].revenue).map(([productName, v]) => ({ productName, ...v }));
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(r => r.productName.toLowerCase().includes(s));
    }
  } else if (type === 'broadcast') {
    const { data: broadcasts } = await supabaseAdmin
      .from('broadcasts')
      .select('id, title, date_text, broadcast_products(product_id)')
      .order('id', { ascending: false });
    // 방송별 매출 계산: broadcast_products 상품과 order_items 매칭
    const orderIds = orders.map(o => o.id);
    let allItems = [];
    if (orderIds.length > 0) {
      const { data: itemsData } = await supabaseAdmin.from('order_items').select('product_id, qty, subtotal').in('order_id', orderIds);
      allItems = itemsData || [];
    }
    rows = (broadcasts || []).map(b => {
      const bProductIds = (b.broadcast_products || []).map(bp => bp.product_id);
      const matchedItems = allItems.filter(i => bProductIds.includes(i.product_id));
      return {
        broadcastTitle: b.title,
        orderCount: matchedItems.length,
        revenue: matchedItems.reduce((s, i) => s + i.subtotal, 0),
      };
    });
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(r => r.broadcastTitle.toLowerCase().includes(s));
    }
  }

  return ok(res, { summary, rows });
}

// ============================================================
//  INVENTORY (재고관리)
// ============================================================
async function handleInventory(req, res) {
  if (req.method === 'GET') {
    const { search, page = '1', limit = '30' } = req.query || {};
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let query;
    if (search) {
      // 상품명으로 검색 시 inner join 필요
      query = supabaseAdmin
        .from('inventory')
        .select('*, products!inner(name)', { count: 'exact' })
        .ilike('products.name', `%${search}%`)
        .order('id', { ascending: false })
        .range(offset, offset + limitNum - 1);
    } else {
      query = supabaseAdmin
        .from('inventory')
        .select('*, products(name)', { count: 'exact' })
        .order('id', { ascending: false })
        .range(offset, offset + limitNum - 1);
    }

    const { data, error, count } = await query;
    if (error) return fail(res, error.message, 500);

    const inventory = (data || []).map(inv => ({
      id: inv.id, productId: inv.product_id,
      productName: inv.products ? inv.products.name : '',
      colorName: inv.color_name, sizeName: inv.size_name,
      stockQty: inv.stock_qty,
    }));
    return ok(res, { inventory, total: count, page: pageNum, limit: limitNum });
  }

  if (req.method === 'POST') {
    const { productId, colorName, sizeName, qty, type, reason } = req.body;
    if (!productId) return fail(res, '상품을 선택해주세요');

    // upsert inventory
    const { data: existing } = await supabaseAdmin.from('inventory')
      .select('id, stock_qty')
      .eq('product_id', productId)
      .eq('color_name', colorName || '')
      .eq('size_name', sizeName || '')
      .single();

    let invId;
    if (existing) {
      const newQty = type === 'adjust' ? qty : existing.stock_qty + qty;
      await supabaseAdmin.from('inventory').update({ stock_qty: newQty, updated_at: new Date().toISOString() }).eq('id', existing.id);
      invId = existing.id;
    } else {
      const { data: newInv, error } = await supabaseAdmin.from('inventory')
        .insert({ product_id: productId, color_name: colorName || '', size_name: sizeName || '', stock_qty: qty })
        .select('id').single();
      if (error) return fail(res, error.message, 500);
      invId = newInv.id;
    }

    // log
    await supabaseAdmin.from('inventory_log').insert({
      inventory_id: invId, product_id: productId, type: type || 'in',
      qty, reason: reason || '',
    });

    return ok(res, { id: invId }, 201);
  }

  return fail(res, 'Method not allowed', 405);
}

async function handleInventoryDetail(req, res, id) {
  if (req.method === 'PATCH') {
    const { stockQty, reason } = req.body;

    const { data: inv } = await supabaseAdmin.from('inventory').select('product_id, stock_qty').eq('id', id).single();
    if (!inv) return fail(res, '재고를 찾을 수 없습니다', 404);

    const diff = stockQty - inv.stock_qty;
    await supabaseAdmin.from('inventory').update({ stock_qty: stockQty, updated_at: new Date().toISOString() }).eq('id', id);

    await supabaseAdmin.from('inventory_log').insert({
      inventory_id: parseInt(id), product_id: inv.product_id, type: 'adjust',
      qty: diff, reason: reason || '재고 조정',
    });

    return ok(res, { id: parseInt(id) });
  }
  return fail(res, 'Method not allowed', 405);
}

async function handleInventoryLog(req, res) {
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);
  const { inventoryId, limit = '100' } = req.query || {};
  const limitNum = Math.min(200, Math.max(1, parseInt(limit)));

  let query = supabaseAdmin.from('inventory_log')
    .select('*').order('created_at', { ascending: false }).limit(limitNum);

  if (inventoryId) query = query.eq('inventory_id', inventoryId);

  const { data, error } = await query;
  if (error) return fail(res, error.message, 500);
  return ok(res, { logs: data || [] });
}

// ============================================================
//  RETURNS (반품/교환/취소)
// ============================================================
async function handleReturns(req, res) {
  if (req.method === 'GET') {
    const { status, search, lookupOrder, page = '1', limit = '20' } = req.query || {};

    // 주문번호로 주문+상품 조회 (접수 등록 시 사용)
    if (lookupOrder) {
      const { data: order } = await supabaseAdmin.from('orders').select('id, order_no, name, total, status').eq('order_no', lookupOrder).single();
      if (!order) return fail(res, '해당 주문번호를 찾을 수 없습니다', 404);
      const { data: items } = await supabaseAdmin.from('order_items').select('id, name, color, size, qty, price, subtotal').eq('order_id', order.id);
      return ok(res, { order: { id: order.id, orderNo: order.order_no, name: order.name, total: order.total, status: order.status, items: items || [] } });
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabaseAdmin
      .from('returns')
      .select('*, orders(order_no)', { count: 'exact' })
      .order('id', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (status && status !== 'all') query = query.eq('status', status);
    if (search) {
      query = query.or(`return_no.ilike.%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) return fail(res, error.message, 500);

    let result = (data || []).map(r => ({
      id: r.id, returnNo: r.return_no, orderId: r.order_id,
      orderNo: r.orders ? r.orders.order_no : '',
      type: r.type, status: r.status, reason: r.reason,
      refundAmount: r.refund_amount, memo: r.memo, createdAt: r.created_at,
    }));
    // 주문번호 검색 (접수번호 검색 결과가 없을 때 주문번호로도 검색)
    if (search && result.length === 0) {
      let q2 = supabaseAdmin.from('returns')
        .select('*, orders!inner(order_no)', { count: 'exact' })
        .ilike('orders.order_no', `%${search}%`)
        .order('id', { ascending: false })
        .range(offset, offset + limitNum - 1);
      if (status && status !== 'all') q2 = q2.eq('status', status);
      const { data: d2, count: c2 } = await q2;
      result = (d2 || []).map(r => ({
        id: r.id, returnNo: r.return_no, orderId: r.order_id,
        orderNo: r.orders ? r.orders.order_no : '',
        type: r.type, status: r.status, reason: r.reason,
        refundAmount: r.refund_amount, memo: r.memo, createdAt: r.created_at,
      }));
      return ok(res, { returns: result, total: c2 || 0, page: pageNum, limit: limitNum });
    }

    return ok(res, { returns: result, total: count, page: pageNum, limit: limitNum });
  }

  if (req.method === 'POST') {
    const { orderNo, type, reason, refundAmount, memo, items } = req.body;
    if (!orderNo) return fail(res, '주문번호를 입력해주세요');
    if (!reason) return fail(res, '사유를 입력해주세요');

    const { data: order } = await supabaseAdmin.from('orders').select('id').eq('order_no', orderNo).single();
    if (!order) return fail(res, '해당 주문번호를 찾을 수 없습니다');

    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const { count } = await supabaseAdmin.from('returns').select('id', { count: 'exact', head: true }).ilike('return_no', `RET-${dateStr}%`);
    const returnNo = `RET-${dateStr}-${String((count || 0) + 1).padStart(3, '0')}`;

    const { data, error } = await supabaseAdmin.from('returns')
      .insert({ return_no: returnNo, order_id: order.id, type, status: '접수', reason, refund_amount: refundAmount || 0, memo: memo || '' })
      .select('id').single();
    if (error) return fail(res, error.message, 500);

    // 반품 상품 저장
    if (items && items.length > 0) {
      const returnItems = items.map(i => ({
        return_id: data.id, order_item_id: i.orderItemId || null,
        product_id: i.productId || null, name: i.name,
        color: i.color || '', size: i.size || '',
        qty: i.qty, price: i.price || 0,
      }));
      await supabaseAdmin.from('return_items').insert(returnItems);
    }

    return ok(res, { id: data.id, returnNo }, 201);
  }

  return fail(res, 'Method not allowed', 405);
}

async function handleReturnDetail(req, res, id) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('returns')
      .select('*, orders(order_no, name, total, status), return_items(*)')
      .eq('id', id).single();
    if (error || !data) return fail(res, '접수를 찾을 수 없습니다', 404);

    // 원래 주문의 상품 목록도 함께 반환
    let orderItems = [];
    if (data.order_id) {
      const { data: oi } = await supabaseAdmin.from('order_items').select('id, name, color, size, qty, price, subtotal').eq('order_id', data.order_id);
      orderItems = (oi || []).map(i => ({ id: i.id, name: i.name, color: i.color, size: i.size, qty: i.qty, price: i.price, subtotal: i.subtotal }));
    }

    return ok(res, {
      returnData: {
        id: data.id, returnNo: data.return_no, orderId: data.order_id,
        orderNo: data.orders ? data.orders.order_no : '',
        orderName: data.orders ? data.orders.name : '',
        orderTotal: data.orders ? data.orders.total : 0,
        orderStatus: data.orders ? data.orders.status : '',
        type: data.type, status: data.status, reason: data.reason,
        refundAmount: data.refund_amount, memo: data.memo, createdAt: data.created_at,
        items: (data.return_items || []).map(i => ({
          id: i.id, name: i.name, color: i.color, size: i.size, qty: i.qty, price: i.price,
        })),
        orderItems,
      }
    });
  }

  if (req.method === 'PATCH') {
    const { status, memo } = req.body;
    const update = { updated_at: new Date().toISOString() };
    if (status) update.status = status;
    if (memo !== undefined) update.memo = memo;

    const { error } = await supabaseAdmin.from('returns').update(update).eq('id', id);
    if (error) return fail(res, error.message, 500);
    return ok(res, { id: parseInt(id) });
  }

  return fail(res, 'Method not allowed', 405);
}

// ============================================================
//  REPORTS (통계/리포트)
// ============================================================
async function handleReports(req, res) {
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);

  const { type = 'sales-ranking', from, to } = req.query || {};
  let rows = [];
  let summary = {};

  // 날짜 범위 적용된 주문 조회
  let orderQuery = supabaseAdmin.from('orders').select('id, user_id, name, total, created_at').neq('status', '취소');
  if (from) orderQuery = orderQuery.gte('created_at', from + 'T00:00:00');
  if (to) orderQuery = orderQuery.lte('created_at', to + 'T23:59:59');
  const { data: orders } = await orderQuery;
  const orderIds = (orders || []).map(o => o.id);

  if (type === 'sales-ranking') {
    let items = [];
    if (orderIds.length > 0) {
      const { data: itemsData } = await supabaseAdmin.from('order_items').select('name, qty, subtotal').in('order_id', orderIds);
      items = itemsData || [];
    }
    const grouped = {};
    items.forEach(i => {
      if (!grouped[i.name]) grouped[i.name] = { totalQty: 0, revenue: 0 };
      grouped[i.name].totalQty += i.qty;
      grouped[i.name].revenue += i.subtotal;
    });
    rows = Object.entries(grouped).sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([productName, v]) => ({ productName, ...v }));
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    const totalQty = rows.reduce((s, r) => s + r.totalQty, 0);
    summary = { totalRevenue, totalQty, productCount: rows.length, top: rows[0]?.productName || '-' };
  } else if (type === 'customer') {
    const grouped = {};
    (orders || []).forEach(o => {
      const key = o.user_id || o.name;
      if (!grouped[key]) grouped[key] = { name: o.name, orderCount: 0, totalSpent: 0, lastOrderAt: null };
      grouped[key].orderCount++;
      grouped[key].totalSpent += o.total;
      if (!grouped[key].lastOrderAt || o.created_at > grouped[key].lastOrderAt) grouped[key].lastOrderAt = o.created_at;
    });
    rows = Object.values(grouped).sort((a, b) => b.totalSpent - a.totalSpent);
    const totalCustomers = rows.length;
    const totalSpent = rows.reduce((s, r) => s + r.totalSpent, 0);
    const avgSpent = totalCustomers > 0 ? Math.round(totalSpent / totalCustomers) : 0;
    summary = { totalCustomers, totalSpent, avgSpent, topCustomer: rows[0]?.name || '-' };
  } else if (type === 'broadcast') {
    const { data: broadcasts } = await supabaseAdmin
      .from('broadcasts')
      .select('id, title, date_text, status, broadcast_products(product_id)')
      .order('id', { ascending: false });
    // 방송별 매출 계산
    let allItems = [];
    if (orderIds.length > 0) {
      const { data: itemsData } = await supabaseAdmin.from('order_items').select('product_id, qty, subtotal').in('order_id', orderIds);
      allItems = itemsData || [];
    }
    rows = (broadcasts || []).map(b => {
      const bProductIds = (b.broadcast_products || []).map(bp => bp.product_id);
      const matched = allItems.filter(i => bProductIds.includes(i.product_id));
      return {
        title: b.title, date: b.date_text, status: b.status,
        productCount: bProductIds.length,
        salesQty: matched.reduce((s, i) => s + i.qty, 0),
        revenue: matched.reduce((s, i) => s + i.subtotal, 0),
      };
    });
    const totalBcRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    const topBc = rows.reduce((best, r) => r.revenue > (best?.revenue || 0) ? r : best, null);
    summary = { totalBroadcasts: rows.length, totalBcRevenue, topBroadcast: topBc?.title || '-' };
  }

  return ok(res, { rows, summary });
}

// ============================================================
//  SETTINGS (시스템 설정)
// ============================================================
async function handleSettings(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin.from('system_settings').select('*');
    if (error) return fail(res, error.message, 500);
    const settings = {};
    (data || []).forEach(s => { settings[s.key] = s.value; });
    return ok(res, settings);
  }

  if (req.method === 'PATCH') {
    const { key, value } = req.body;
    if (!key) return fail(res, 'key는 필수입니다');
    const { error } = await supabaseAdmin.from('system_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) return fail(res, error.message, 500);
    return ok(res, { key });
  }

  return fail(res, 'Method not allowed', 405);
}

// ============================================================
//  ADMIN USERS (관리자 계정)
// ============================================================
async function handleAdminUsers(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin.from('users').select('id, name, phone, role, created_at').eq('role', 'admin').order('created_at');
    if (error) return fail(res, error.message, 500);
    const users = (data || []).map(u => ({ id: u.id, name: u.name, phone: u.phone, role: u.role, createdAt: u.created_at }));
    return ok(res, { users });
  }

  if (req.method === 'POST') {
    const { phone, name, password } = req.body;
    if (!phone || !name || !password) return fail(res, '모든 필드를 입력해주세요');

    const { data, error } = await supabaseAdmin.from('users')
      .upsert({ phone, name, password, role: 'admin' }, { onConflict: 'phone' })
      .select('id').single();
    if (error) return fail(res, error.message, 500);
    return ok(res, { id: data.id }, 201);
  }

  if (req.method === 'PATCH') {
    const { userId, action, newPassword } = req.body;
    if (!userId) return fail(res, 'userId는 필수입니다');
    if (action === 'reset-password') {
      const pw = newPassword || '0000';
      const { error } = await supabaseAdmin.from('users').update({ password: pw }).eq('id', userId);
      if (error) return fail(res, error.message, 500);
      return ok(res, { message: '비밀번호가 초기화되었습니다' });
    }
    if (action === 'demote') {
      const { error } = await supabaseAdmin.from('users').update({ role: 'user' }).eq('id', userId);
      if (error) return fail(res, error.message, 500);
      return ok(res, { message: '관리자 권한이 해제되었습니다' });
    }
    return fail(res, '알 수 없는 액션입니다');
  }

  return fail(res, 'Method not allowed', 405);
}

// ============================================================
//  LOGS (활동 로그)
// ============================================================
async function handleLogs(req, res) {
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);

  const { limit = '30', page = '1', from, to, action } = req.query || {};
  const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
  const pageNum = Math.max(1, parseInt(page));
  const offset = (pageNum - 1) * limitNum;

  let query = supabaseAdmin.from('admin_logs').select('*', { count: 'exact' });
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to + 'T23:59:59');
  if (action) query = query.eq('action', action);
  query = query.order('created_at', { ascending: false }).range(offset, offset + limitNum - 1);

  const { data, error, count } = await query;
  if (error) return fail(res, error.message, 500);

  const logs = (data || []).map(l => ({
    id: l.id, userId: l.user_id, userName: l.user_name,
    action: l.action, targetType: l.target_type, targetId: l.target_id,
    detail: l.detail, createdAt: l.created_at,
  }));
  return ok(res, { logs, total: count || 0, page: pageNum, limit: limitNum });
}


