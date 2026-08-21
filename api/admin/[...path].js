const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin, getUserFromRequest } = require('../_lib/auth');
const { ok, fail, handleCors } = require('../_lib/response');

// 관리자 활동 로그 기록
const LOG_ACTION_KR = {
  'CREATE': '등록', 'UPDATE': '수정', 'DELETE': '삭제', 'STATUS_CHANGE': '상태변경',
};
const LOG_TARGET_KR = {
  'order': '주문관리', 'product': '상품관리', 'broadcast': '방송관리',
  'member': '회원관리', 'vendor': '거래처관리', 'settings': '시스템설정',
};
async function writeLog(admin, action, targetType, targetId, detail) {
  try {
    // 사람이 읽기 좋은 요약 생성
    const menu = LOG_TARGET_KR[targetType] || targetType;
    const act = LOG_ACTION_KR[action] || action;
    let summary = `[${menu}] `;
    if (action === 'STATUS_CHANGE' && detail.from && detail.to) {
      summary += detail.item
        ? `주문 ${targetId} [${detail.item}] "${detail.from || '없음'}" → "${detail.to}"`
        : `주문 ${targetId} 상태 "${detail.from}" → "${detail.to}"`;
    } else if (action === 'CREATE') {
      const label = detail.name || detail.title || detail.phone || targetId;
      summary += `"${label}" ${act}`;
    } else if (action === 'DELETE') {
      const label = detail.name || detail.title || targetId;
      summary += `"${label}" ${act}`;
    } else if (action === 'UPDATE' && targetType === 'order' && detail.trackingNo) {
      summary += `주문 ${targetId} 송장입력 (${detail.trackingCarrier || ''} ${detail.trackingNo})`;
    } else if (action === 'UPDATE' && targetType === 'settings') {
      summary += `${targetId} 설정 변경`;
    } else {
      const label = detail.name || detail.title || targetId;
      summary += `"${label}" ${act}`;
    }

    const { error } = await supabaseAdmin.from('admin_logs').insert({
      user_id: admin.id,
      user_name: admin.name,
      action,
      target_type: menu,
      target_id: summary,
      detail: detail || {},
    });
    if (error) console.error('writeLog DB error:', error.message, error.details);
  } catch (e) { console.error('writeLog error:', e.message); }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const admin = requireAdmin(req, res, fail);
  if (!admin) return;
  req._admin = admin;  // 핸들러에서 로그 기록용

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
    case 'orders':
      if (resourceId === 'merge') return handleOrderMerge(req, res);
      if (resourceId && pathSegments[2] === 'items' && pathSegments[3]) {
        return handleOrderItemDetail(req, res, resourceId, pathSegments[3]);
      }
      return resourceId ? handleOrderDetail(req, res, resourceId) : handleOrders(req, res);
    case 'products': return resourceId ? handleProductDetail(req, res, resourceId) : handleProducts(req, res);
    case 'broadcasts': return resourceId ? handleBroadcastDetail(req, res, resourceId) : handleBroadcasts(req, res);
    case 'shipping-excel': return handleShippingExcel(req, res);
    case 'shipping-import': return handleShippingImport(req, res);
    case 'members':  return resourceId ? handleMemberDetail(req, res, resourceId) : handleMembers(req, res);
    case 'vendors':  return resourceId ? handleVendorDetail(req, res, resourceId) : handleVendors(req, res);
    case 'purchase-orders': return resourceId ? handlePurchaseOrderDetail(req, res, resourceId) : handlePurchaseOrders(req, res);
    case 'sales':    return handleSales(req, res);
    case 'inventory': return resourceId ? handleInventoryDetail(req, res, resourceId) : handleInventory(req, res);
    case 'inventory-log': return handleInventoryLog(req, res);
    case 'returns':  return resourceId ? handleReturnDetail(req, res, resourceId) : handleReturns(req, res);
    case 'chat':     return handleChat(req, res);
    case 'after-services': return resourceId ? handleAfterServiceDetail(req, res, resourceId) : handleAfterServices(req, res);
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

  const { status, search, page = '1', limit = '20', after } = req.query || {};

  // 신규 주문 알림용: after 이후에 생성된 주문만 경량 반환
  if (after) {
    let q = supabaseAdmin
      .from('orders')
      .select('id, order_no, name, total, created_at')
      .gt('created_at', after)
      .order('created_at', { ascending: true })
      .limit(20);
    const { data, error } = await q;
    if (error) return fail(res, error.message, 500);
    return ok(res, { orders: (data || []).map(o => ({ id: o.id, orderNo: o.order_no, name: o.name, total: o.total, createdAt: o.created_at })) });
  }

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
    nickname: o.social || '',
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
      id: i.id,
      name: i.name, color: i.color, size: i.size, qty: i.qty, price: i.price, subtotal: i.subtotal,
      vendorName: vendorMap[i.product_id] || '',
      allocatedQty: i.allocated_qty || 0,
      status: i.status || null,
      trackingNo: i.tracking_no || '',
      trackingCarrier: i.tracking_carrier || '',
    })),
  }));

  return ok(res, { orders: result, total: count, page: pageNum, limit: limitNum });
}

// ============================================================
//  ORDER MERGE (POST)
// ============================================================
async function handleOrderMerge(req, res) {
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);

  const { targetId, sourceIds } = req.body || {};
  if (!targetId || !Array.isArray(sourceIds) || sourceIds.length === 0) {
    return fail(res, 'targetId와 sourceIds가 필요합니다', 400);
  }

  const BLOCKED_STATUSES = ['배송완료', '결제취소'];

  // 1) target + source 주문 전체 조회
  const allIds = [targetId, ...sourceIds];
  const { data: orders, error: fetchErr } = await supabaseAdmin.from('orders')
    .select('id, name, phone, status, broadcast_id, subtotal, total')
    .in('id', allIds);
  if (fetchErr) return fail(res, fetchErr.message, 500);
  if (!orders || orders.length !== allIds.length) {
    return fail(res, '일부 주문을 찾을 수 없습니다', 404);
  }

  const target = orders.find(o => o.id === targetId);
  if (!target) return fail(res, '대상 주문을 찾을 수 없습니다', 404);

  // 2) 검증: 같은 name + phone
  const sameBuyer = orders.every(o => o.name === target.name && o.phone === target.phone);
  if (!sameBuyer) {
    return fail(res, '같은 주문자(이름+연락처)의 주문만 병합할 수 있습니다', 400);
  }

  // 3) 검증: 배송완료/결제취소 상태는 병합 불가
  const blocked = orders.filter(o => BLOCKED_STATUSES.includes(o.status));
  if (blocked.length > 0) {
    return fail(res, `병합 불가 상태(${blocked.map(o => o.status).join(', ')})의 주문이 포함되어 있습니다`, 400);
  }

  // 4) source의 order_items → target order_id로 UPDATE
  for (const srcId of sourceIds) {
    const { error: moveErr } = await supabaseAdmin.from('order_items')
      .update({ order_id: targetId })
      .eq('order_id', srcId);
    if (moveErr) return fail(res, `품목 이동 실패: ${moveErr.message}`, 500);
  }

  // 5) source 발주 수량 차감
  for (const srcId of sourceIds) {
    await deductPurchaseOrderQty(srcId);
  }

  // 6) target subtotal/total 재계산 (items 합산 + target 배송비)
  const { data: targetItems } = await supabaseAdmin.from('order_items')
    .select('subtotal')
    .eq('order_id', targetId);
  const { data: targetOrder } = await supabaseAdmin.from('orders')
    .select('shipping_fee').eq('id', targetId).single();
  const newSubtotal = (targetItems || []).reduce((sum, i) => sum + (i.subtotal || 0), 0);
  const shippingFee = targetOrder?.shipping_fee || 0;
  const { error: updateErr } = await supabaseAdmin.from('orders')
    .update({ subtotal: newSubtotal, total: newSubtotal + shippingFee })
    .eq('id', targetId);
  if (updateErr) return fail(res, `금액 재계산 실패: ${updateErr.message}`, 500);

  // 7) source 주문 DELETE (order_items는 이미 이동됨)
  for (const srcId of sourceIds) {
    await supabaseAdmin.from('order_items').delete().eq('order_id', srcId);
    await supabaseAdmin.from('orders').delete().eq('id', srcId);
  }

  // 8) 로그 기록
  await writeLog(req._admin, 'UPDATE', 'order', targetId, {
    action: '주문병합',
    mergedFrom: sourceIds,
    name: target.name,
  });

  return ok(res, { merged: true, targetId, mergedCount: sourceIds.length });
}

// ============================================================
//  ORDER DETAIL (PATCH)
// ============================================================
async function handleOrderDetail(req, res, id) {
  // 주문 삭제
  if (req.method === 'DELETE') {
    const { data: order } = await supabaseAdmin.from('orders').select('id, status, broadcast_id').eq('id', id).single();
    if (!order) return fail(res, '주문을 찾을 수 없습니다', 404);
    // 발주가 진행된 상태면 삭제 차단
    const poBlock = await checkAdvancedPurchaseOrders(id);
    if (poBlock) return fail(res, poBlock);
    // 발주 차감 (항상 시도) — 재고 차감/복원은 입고 배정으로 대체
    await deductPurchaseOrderQty(id);
    await supabaseAdmin.from('order_items').delete().eq('order_id', id);
    const { error } = await supabaseAdmin.from('orders').delete().eq('id', id);
    if (error) return fail(res, error.message, 500);
    await writeLog(req._admin, 'DELETE', 'order', id, { status: order.status });
    return ok(res, { deleted: true });
  }

  if (req.method !== 'PATCH') return fail(res, 'Method not allowed', 405);

  const { status, trackingNo, trackingCarrier } = req.body;
  const validStatuses = ['입금확인', '결제완료', '결제취소', '배송준비', '배송완료'];
  if (status && !validStatuses.includes(status)) return fail(res, `유효하지 않은 상태입니다: ${status}`);

  // 기존 상태 확인 (중복 차감 방지 + 발주 진행 체크)
  let prevStatus = null;
  const { data: prev } = await supabaseAdmin.from('orders').select('status').eq('id', id).single();
  if (prev) prevStatus = prev.status;

  // 결제완료에서 취소/되돌릴 때만 발주 진행 상태 체크 (배송 진행은 허용)
  if (prevStatus === '결제완료' && ['입금확인', '결제취소'].includes(status)) {
    const poBlock = await checkAdvancedPurchaseOrders(id);
    if (poBlock) return fail(res, poBlock);
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

  // 결제완료 전환 시 자동 발주 생성 + 모든 품목 status = '결제완료'
  if (status === '결제완료' && prevStatus && prevStatus !== '결제완료') {
    await createAutoPurchaseOrders(id);
    await supabaseAdmin.from('order_items')
      .update({ status: '결제완료' })
      .eq('order_id', id);
  }
  // 결제완료에서 다른 상태로 변경 시 발주 수량 차감
  if (prevStatus === '결제완료' && status !== '결제완료') {
    await deductPurchaseOrderQty(id);
  }
  // 배송완료 전환 시 미배송 품목만 재고 차감 + 배정 해제 + 송장번호 기록 + status 갱신
  if (status === '배송완료' && prevStatus !== '배송완료') {
    // 아직 배송완료가 아닌 품목만 처리
    const { data: pendingItems } = await supabaseAdmin.from('order_items')
      .select('*').eq('order_id', id)
      .not('status', 'in', '("배송완료")');
    if (pendingItems && pendingItems.length > 0) {
      for (const item of pendingItems) {
        await deductInventoryForItem(item);
      }
      const pendingIds = pendingItems.map(i => i.id);
      await supabaseAdmin.from('order_items')
        .update({ status: '배송완료', allocated_qty: 0, tracking_no: trackingNo || '', tracking_carrier: trackingCarrier || '' })
        .in('id', pendingIds);
    }
  }
  // 배송완료에서 이전 상태로 되돌릴 때 재고 복원
  if (prevStatus === '배송완료' && status !== '배송완료' && status !== '결제취소') {
    await deductInventory(id, 'restore');
  }
  // 결제취소 시: 배송준비 이후 불가 + 전 품목 취소 + 배정 수량 초기화
  if (status === '결제취소') {
    if (['배송준비', '배송완료'].includes(prevStatus)) {
      return fail(res, '배송준비 이후에는 결제취소가 불가능합니다');
    }
    await supabaseAdmin.from('order_items')
      .update({ status: '결제취소', allocated_qty: 0 })
      .eq('order_id', id);
  }
  // 입금확인 전환 시 품목 상태도 입금확인으로
  if (status === '입금확인') {
    await supabaseAdmin.from('order_items')
      .update({ status: '입금확인' })
      .eq('order_id', id);
  }
  // 배송준비 전환 시 미배송 품목 상태 갱신
  if (status === '배송준비' && prevStatus !== '배송준비') {
    await supabaseAdmin.from('order_items')
      .update({ status: '배송준비' })
      .eq('order_id', id)
      .not('status', 'in', '("배송완료","결제취소")');
  }

  if (status) await writeLog(req._admin, 'STATUS_CHANGE', 'order', data.order_no, { from: prevStatus, to: status });
  if (trackingNo !== undefined) await writeLog(req._admin, 'UPDATE', 'order', data.order_no, { trackingNo, trackingCarrier });

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
          reason: action === 'sale' ? '주문 결제완료 자동 차감' : '주문 상태변경 재고 복원',
        });
      }
    }
  } catch (e) { /* 재고 차감 실패해도 주문 처리는 유지 */ }
}

// 품목 1개 재고 차감 헬퍼
async function deductInventoryForItem(item) {
  try {
    const { data: inv } = await supabaseAdmin.from('inventory')
      .select('id, stock_qty')
      .eq('product_id', item.product_id)
      .eq('color_name', item.color || '')
      .eq('size_name', item.size || '')
      .single();

    if (inv) {
      const newQty = Math.max(0, inv.stock_qty - item.qty);
      await supabaseAdmin.from('inventory').update({ stock_qty: newQty, updated_at: new Date().toISOString() }).eq('id', inv.id);
      await supabaseAdmin.from('inventory_log').insert({
        inventory_id: inv.id, product_id: item.product_id,
        type: 'sale', qty: -item.qty,
        reason: '품목별 배송 출고',
      });
    }
  } catch (e) { /* 재고 차감 실패해도 처리 유지 */ }
}

// 주문 상태 자동 재계산 — 품목 상태 중 가장 낮은 단계를 주문 상태로 반영
async function recalcOrderStatus(orderId) {
  try {
    const { data: items } = await supabaseAdmin.from('order_items')
      .select('status').eq('order_id', orderId);
    if (!items || items.length === 0) return;

    // NULL 상태 품목이 있으면 주문 상태는 변경하지 않음 (결제 전)
    const statuses = items.map(i => i.status).filter(Boolean);
    if (statuses.length === 0) return;

    // 전부 결제취소 → 주문도 결제취소
    if (statuses.every(s => s === '결제취소')) {
      await supabaseAdmin.from('orders').update({ status: '결제취소' }).eq('id', orderId);
      return;
    }

    // 결제취소가 아닌 품목만으로 가장 낮은 단계 계산
    const activeStatuses = statuses.filter(s => s !== '결제취소');
    if (activeStatuses.length === 0) return;

    const priority = { '결제완료': 1, '배송준비': 2, '배송완료': 3 };
    const minPriority = Math.min(...activeStatuses.map(s => priority[s] || 1));

    const statusMap = { 1: '결제완료', 2: '배송준비', 3: '배송완료' };
    const newStatus = statusMap[minPriority] || '결제완료';

    await supabaseAdmin.from('orders').update({ status: newStatus }).eq('id', orderId);
  } catch (e) { /* 상태 재계산 실패해도 처리 유지 */ }
}

// ============================================================
//  ORDER ITEM DETAIL (품목별 상태 변경)
// ============================================================
async function handleOrderItemDetail(req, res, orderId, itemId) {
  if (req.method !== 'PATCH') return fail(res, 'Method not allowed', 405);

  const { status, trackingNo, trackingCarrier } = req.body;
  const validStatuses = ['입금확인', '결제완료', '결제취소', '배송준비', '배송완료'];
  if (status && !validStatuses.includes(status)) return fail(res, `유효하지 않은 품목 상태입니다: ${status}`);

  // 기존 품목 조회
  const { data: item, error: itemErr } = await supabaseAdmin.from('order_items')
    .select('*').eq('id', itemId).eq('order_id', orderId).single();
  if (itemErr || !item) return fail(res, '품목을 찾을 수 없습니다', 404);

  const prevStatus = item.status;
  const update = {};
  if (status) update.status = status;
  if (trackingNo !== undefined) update.tracking_no = trackingNo;
  if (trackingCarrier !== undefined) update.tracking_carrier = trackingCarrier;

  if (Object.keys(update).length === 0) return fail(res, '변경할 내용이 없습니다');

  // 배송완료 전환 시 해당 품목만 재고 차감 + 배정 해제
  if (status === '배송완료' && prevStatus !== '배송완료') {
    await deductInventoryForItem(item);
    await supabaseAdmin.from('order_items')
      .update({ allocated_qty: 0 })
      .eq('id', itemId);
  }

  // 결제취소 시: 배송준비 이후 불가 + 배정 수량 초기화
  if (status === '결제취소') {
    if (['배송준비', '배송완료'].includes(prevStatus)) {
      return fail(res, '배송준비 이후에는 결제취소가 불가능합니다');
    }
    update.allocated_qty = 0;
  }

  const { error } = await supabaseAdmin.from('order_items').update(update).eq('id', itemId);
  if (error) return fail(res, error.message, 500);

  // 결제완료 전환 시 발주에 품목 추가
  if (status === '결제완료' && prevStatus !== '결제완료') {
    await addItemToPurchaseOrder(orderId, item);
  }
  // 결제완료에서 다른 상태로 변경 시 발주에서 품목 차감
  if (prevStatus === '결제완료' && status && status !== '결제완료') {
    await deductItemFromPurchaseOrder(orderId, item);
  }

  // 주문 상태 자동 재계산
  await recalcOrderStatus(orderId);

  // 활동 로그
  const { data: orderInfo } = await supabaseAdmin.from('orders').select('order_no').eq('id', orderId).single();
  const orderNo = orderInfo?.order_no || orderId;
  const productName = item.product_name || item.product_id;
  if (status) await writeLog(req._admin, 'STATUS_CHANGE', 'order', orderNo, { from: prevStatus, to: status, item: productName });
  if (trackingNo !== undefined) await writeLog(req._admin, 'UPDATE', 'order', orderNo, { trackingNo, trackingCarrier, item: productName });

  return ok(res, { id: parseInt(itemId), status: status || prevStatus });
}

// 입고 시 재고(inventory) 반영 — received_qty 기준으로 재고 upsert
async function updateInventoryFromPO(poId) {
  try {
    const { data: poItems } = await supabaseAdmin.from('purchase_order_items')
      .select('product_id, color_name, size_name, received_qty')
      .eq('purchase_order_id', poId);
    if (!poItems || poItems.length === 0) return { updated: 0 };

    let updated = 0;
    for (const item of poItems) {
      const receivedQty = item.received_qty || 0;
      if (receivedQty <= 0 || !item.product_id) continue;

      // 기존 재고 조회
      const { data: inv } = await supabaseAdmin.from('inventory')
        .select('id, stock_qty')
        .eq('product_id', item.product_id)
        .eq('color_name', item.color_name || '')
        .eq('size_name', item.size_name || '')
        .single();

      // 이미 이 PO에서 반영된 입고 로그가 있는지 확인 (중복 방지)
      const poRef = `PO#${poId}`;
      const { data: existingLog } = await supabaseAdmin.from('inventory_log')
        .select('id')
        .eq('product_id', item.product_id)
        .eq('reason', poRef)
        .limit(1);
      if (existingLog && existingLog.length > 0) continue; // 이미 반영됨

      let invId;
      if (inv) {
        const newQty = inv.stock_qty + receivedQty;
        await supabaseAdmin.from('inventory')
          .update({ stock_qty: newQty, updated_at: new Date().toISOString() })
          .eq('id', inv.id);
        invId = inv.id;
      } else {
        const { data: newInv } = await supabaseAdmin.from('inventory')
          .insert({ product_id: item.product_id, color_name: item.color_name || '', size_name: item.size_name || '', stock_qty: receivedQty })
          .select('id').single();
        if (newInv) invId = newInv.id;
      }

      if (invId) {
        await supabaseAdmin.from('inventory_log').insert({
          inventory_id: invId, product_id: item.product_id,
          type: 'in', qty: receivedQty, reason: poRef,
        });
        updated++;
      }
    }
    return { updated };
  } catch (e) { return { updated: 0, error: e.message }; }
}

// 입고 시 고객별 FIFO 배정
async function allocateReceivedToOrders(poId) {
  try {
    // 1) PO 품목별 received_qty 조회
    const { data: poItems } = await supabaseAdmin.from('purchase_order_items')
      .select('id, product_id, color_name, size_name, qty, received_qty')
      .eq('purchase_order_id', poId);
    if (!poItems || poItems.length === 0) return { allocated: 0, orders: 0 };

    let totalAllocated = 0;
    const allocatedOrderIds = new Set();
    const processedCombos = new Set();

    for (const poItem of poItems) {
      if (!poItem.product_id) continue;

      // 동일 상품/색상/사이즈 조합 중복 처리 방지
      const comboKey = `${poItem.product_id}|${poItem.color_name}|${poItem.size_name}`;
      if (processedCombos.has(comboKey)) continue;
      processedCombos.add(comboKey);

      // 2) 해당 상품/색상/사이즈의 전체 PO 입고 수량 합계
      const { data: allPOItems } = await supabaseAdmin.from('purchase_order_items')
        .select('received_qty')
        .eq('product_id', poItem.product_id)
        .eq('color_name', poItem.color_name)
        .eq('size_name', poItem.size_name);
      const totalReceived = (allPOItems || []).reduce((s, i) => s + (i.received_qty || 0), 0);
      if (totalReceived <= 0) continue;

      // 3) 이미 배정된 총량 조회 (모든 주문 대상 — 배송준비 등 이미 전환된 주문 포함)
      const { data: allAllocItems } = await supabaseAdmin
        .from('order_items')
        .select('allocated_qty')
        .eq('product_id', poItem.product_id)
        .eq('color', poItem.color_name)
        .eq('size', poItem.size_name)
        .gt('allocated_qty', 0);
      const totalAlreadyAllocated = (allAllocItems || []).reduce((s, oi) => s + (oi.allocated_qty || 0), 0);

      let remaining = Math.max(0, totalReceived - totalAlreadyAllocated);
      if (remaining <= 0) continue;

      // 4) 결제완료 주문 조회 (FIFO: created_at ASC)
      const { data: paidOrders } = await supabaseAdmin
        .from('orders')
        .select('id')
        .eq('status', '결제완료')
        .order('created_at', { ascending: true });
      if (!paidOrders || paidOrders.length === 0) continue;

      const paidOrderIds = paidOrders.map(o => o.id);

      // 매칭되는 주문 품목 조회
      const { data: matchingItems } = await supabaseAdmin
        .from('order_items')
        .select('id, order_id, qty, allocated_qty')
        .eq('product_id', poItem.product_id)
        .eq('color', poItem.color_name)
        .eq('size', poItem.size_name)
        .in('order_id', paidOrderIds);

      if (!matchingItems || matchingItems.length === 0) continue;

      // FIFO 정렬: paidOrders 순서 기준
      const orderIndexMap = {};
      paidOrderIds.forEach((oid, idx) => { orderIndexMap[oid] = idx; });
      matchingItems.sort((a, b) => (orderIndexMap[a.order_id] || 0) - (orderIndexMap[b.order_id] || 0));

      // 5) FIFO 배정: 남은 수량을 순서대로 배분
      for (const oi of matchingItems) {
        if (remaining <= 0) break;
        const needed = oi.qty - (oi.allocated_qty || 0);
        if (needed <= 0) continue;

        const allocate = Math.min(needed, remaining);
        const newAllocated = (oi.allocated_qty || 0) + allocate;

        // 품목 배정 수량만 갱신 (상태는 전량 배정 시 일괄 배송준비로 처리)
        const itemUpdate = { allocated_qty: newAllocated };
        await supabaseAdmin.from('order_items')
          .update(itemUpdate)
          .eq('id', oi.id);

        remaining -= allocate;
        totalAllocated += allocate;
        allocatedOrderIds.add(oi.order_id);
      }
    }

    // 6) 품목별 상태 확인 + 전량 배정 시 배송준비 자동 승격 + 주문 상태 재계산
    for (const orderId of allocatedOrderIds) {
      const { data: orderItems } = await supabaseAdmin.from('order_items')
        .select('id, qty, allocated_qty, status').eq('order_id', orderId);
      if (!orderItems || orderItems.length === 0) continue;

      // 전량 배정된 품목 → 배송준비로 자동 승격
      const allAllocated = orderItems.every(oi => (oi.allocated_qty || 0) >= oi.qty);
      if (allAllocated) {
        // 모든 품목 전량 배정 → 결제완료 품목을 배송준비로
        const pendingItems = orderItems.filter(oi => oi.status === '결제완료');
        for (const oi of pendingItems) {
          await supabaseAdmin.from('order_items')
            .update({ status: '배송준비' })
            .eq('id', oi.id);
        }
        await supabaseAdmin.from('orders')
          .update({ status: '배송준비' })
          .eq('id', orderId)
          .eq('status', '결제완료');
      }

      // 주문 상태 재계산
      await recalcOrderStatus(orderId);
    }

    return { allocated: totalAllocated, orders: allocatedOrderIds.size };
  } catch (e) {
    return { allocated: 0, orders: 0, error: e.message };
  }
}

// 발주가 발주대기 이후 단계로 진행되었는지 확인 (주문 삭제/취소 차단용)
async function checkAdvancedPurchaseOrders(orderId) {
  try {
    const { data: items } = await supabaseAdmin.from('order_items')
      .select('product_id, color, size').eq('order_id', orderId);
    if (!items || items.length === 0) return null;

    const productIds = [...new Set(items.map(i => i.product_id).filter(Boolean))];
    if (productIds.length === 0) return null;
    const { data: products } = await supabaseAdmin.from('products')
      .select('id, vendor_id').in('id', productIds);
    const vendorIds = [...new Set((products || []).map(p => p.vendor_id).filter(Boolean))];
    if (vendorIds.length === 0) return null;

    // 해당 거래처의 발주대기가 아닌 발주서 확인
    const { data: advancedPOs } = await supabaseAdmin.from('purchase_orders')
      .select('po_no, status')
      .in('vendor_id', vendorIds)
      .in('status', ['발주완료', '입고중', '입고완료'])
      .limit(1);

    if (advancedPOs && advancedPOs.length > 0) {
      return `발주가 진행 중입니다 (${advancedPOs[0].po_no}: ${advancedPOs[0].status}). 발주를 먼저 처리해주세요.`;
    }
    return null;
  } catch (e) { return null; }
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
  } catch (e) { console.error('발주 차감 오류:', e.message || e); }
}

// 단일 품목 발주 추가 헬퍼 (품목별 결제완료 전환 시)
async function addItemToPurchaseOrder(orderId, item) {
  try {
    if (!item.product_id) return;

    // 주문의 broadcast 정보 조회
    let orderBroadcastId = null;
    let orderBroadcastTitle = '';
    try {
      const { data: orderData } = await supabaseAdmin.from('orders')
        .select('broadcast_id, broadcasts:broadcast_id(id, title)').eq('id', orderId).single();
      if (orderData && orderData.broadcast_id) {
        orderBroadcastId = orderData.broadcast_id;
        orderBroadcastTitle = orderData.broadcasts ? orderData.broadcasts.title : '';
      }
    } catch (e) { /* broadcast 조회 실패 무시 */ }

    // 상품 정보 조회 (vendor_id, cost_price)
    const { data: product } = await supabaseAdmin.from('products')
      .select('id, name, vendor_id, cost_price').eq('id', item.product_id).single();
    if (!product || !product.vendor_id) return;

    // 기존 발주대기 발주서 찾기 (동일 거래처 + 동일 방송)
    let query = supabaseAdmin.from('purchase_orders')
      .select('id').eq('vendor_id', product.vendor_id).eq('status', '발주대기');
    if (orderBroadcastId) {
      query = query.eq('broadcast_id', orderBroadcastId);
    }
    const { data: existingPOs } = await query.order('id', { ascending: false }).limit(1);

    let poId;
    if (existingPOs && existingPOs.length > 0) {
      poId = existingPOs[0].id;

      // 기존 품목 매칭
      const { data: existingItem } = await supabaseAdmin.from('purchase_order_items')
        .select('id, qty, cost_price')
        .eq('purchase_order_id', poId)
        .eq('product_id', item.product_id)
        .eq('color_name', item.color || '')
        .eq('size_name', item.size || '')
        .single();

      if (existingItem) {
        const newQty = existingItem.qty + item.qty;
        await supabaseAdmin.from('purchase_order_items')
          .update({ qty: newQty, subtotal: newQty * (existingItem.cost_price || product.cost_price || 0) })
          .eq('id', existingItem.id);
      } else {
        const costPrice = product.cost_price || 0;
        await supabaseAdmin.from('purchase_order_items').insert({
          purchase_order_id: poId, product_id: item.product_id,
          product_name: item.name || product.name,
          color_name: item.color || '', size_name: item.size || '',
          qty: item.qty, cost_price: costPrice, subtotal: item.qty * costPrice,
        });
      }
    } else {
      // 새 발주서 생성
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
      const { count } = await supabaseAdmin.from('purchase_orders')
        .select('id', { count: 'exact', head: true }).ilike('po_no', `PO-${dateStr}%`);
      const poNo = `PO-${dateStr}-${String((count || 0) + 1).padStart(3, '0')}`;

      const costPrice = product.cost_price || 0;
      const totalAmount = item.qty * costPrice;
      const insertData = {
        po_no: poNo, vendor_id: product.vendor_id, status: '발주대기',
        total_amount: totalAmount, memo: orderBroadcastTitle || ''
      };
      if (orderBroadcastId) insertData.broadcast_id = orderBroadcastId;

      let newPO;
      ({ data: newPO } = await supabaseAdmin.from('purchase_orders')
        .insert(insertData).select('id').single());
      if (!newPO && orderBroadcastId) {
        delete insertData.broadcast_id;
        ({ data: newPO } = await supabaseAdmin.from('purchase_orders')
          .insert(insertData).select('id').single());
      }
      if (!newPO) return;
      poId = newPO.id;

      await supabaseAdmin.from('purchase_order_items').insert({
        purchase_order_id: poId, product_id: item.product_id,
        product_name: item.name || product.name,
        color_name: item.color || '', size_name: item.size || '',
        qty: item.qty, cost_price: costPrice, subtotal: totalAmount,
      });
    }

    // total_amount 재계산
    const { data: allItems } = await supabaseAdmin.from('purchase_order_items')
      .select('subtotal').eq('purchase_order_id', poId);
    const newTotal = (allItems || []).reduce((s, i) => s + (i.subtotal || 0), 0);
    await supabaseAdmin.from('purchase_orders').update({
      total_amount: newTotal, updated_at: new Date().toISOString()
    }).eq('id', poId);
  } catch (e) { console.error('품목별 발주 추가 오류:', e.message || e); }
}

// 단일 품목 발주 차감 헬퍼 (품목별 취소/상태 변경 시)
async function deductItemFromPurchaseOrder(orderId, item) {
  try {
    if (!item.product_id) return;

    // 주문의 broadcast 정보 조회
    const { data: order } = await supabaseAdmin.from('orders')
      .select('broadcast_id').eq('id', orderId).single();

    // 상품의 vendor_id 조회
    const { data: product } = await supabaseAdmin.from('products')
      .select('id, vendor_id').eq('id', item.product_id).single();
    if (!product || !product.vendor_id) return;

    // 해당 거래처의 발주대기 발주서 찾기
    let query = supabaseAdmin.from('purchase_orders')
      .select('id').eq('vendor_id', product.vendor_id).eq('status', '발주대기');
    if (order && order.broadcast_id) {
      query = query.eq('broadcast_id', order.broadcast_id);
    }
    const { data: pos } = await query;
    if (!pos || pos.length === 0) return;

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
          await supabaseAdmin.from('purchase_order_items').delete().eq('id', poItem.id);
        } else {
          await supabaseAdmin.from('purchase_order_items')
            .update({ qty: newQty, subtotal: newQty * poItem.cost_price }).eq('id', poItem.id);
        }

        // 남은 품목 확인 후 발주서 total 재계산 또는 삭제
        const { data: remaining } = await supabaseAdmin.from('purchase_order_items')
          .select('subtotal').eq('purchase_order_id', po.id);
        if (!remaining || remaining.length === 0) {
          await supabaseAdmin.from('purchase_orders').delete().eq('id', po.id);
        } else {
          const newTotal = remaining.reduce((s, i) => s + (i.subtotal || 0), 0);
          await supabaseAdmin.from('purchase_orders').update({
            total_amount: newTotal, updated_at: new Date().toISOString()
          }).eq('id', po.id);
        }
        break;
      }
    }
  } catch (e) { console.error('품목별 발주 차감 오류:', e.message || e); }
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
        cost_price: prod.cost_price || 0,
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
  } catch (e) { console.error('자동 발주 생성 오류:', e.message || e); }
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

    await writeLog(req._admin, 'CREATE', 'product', product.id, { name });
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

    await writeLog(req._admin, 'UPDATE', 'product', id, { name: name || undefined });
    return ok(res, { id: parseInt(id) });
  }

  if (req.method === 'DELETE') {
    const { data: delProd } = await supabaseAdmin.from('products').select('name').eq('id', id).single();
    const { error } = await supabaseAdmin.from('products').delete().eq('id', id);
    if (error) return fail(res, error.message, 500);
    await writeLog(req._admin, 'DELETE', 'product', id, { name: delProd?.name });
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

    await writeLog(req._admin, 'CREATE', 'broadcast', broadcast.id, { title });
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
      const { data: allOrders } = await supabaseAdmin.from('orders').select('id').neq('status', '결제취소');
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

    await writeLog(req._admin, 'UPDATE', 'broadcast', id, { title: title || undefined, status: status || undefined });
    return ok(res, { id: parseInt(id) });
  }

  if (req.method === 'DELETE') {
    const { data: delBc } = await supabaseAdmin.from('broadcasts').select('title').eq('id', id).single();
    const { error } = await supabaseAdmin.from('broadcasts').delete().eq('id', id);
    if (error) return fail(res, error.message, 500);
    await writeLog(req._admin, 'DELETE', 'broadcast', id, { title: delBc?.title });
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
//  SHIPPING IMPORT (운송장 엑셀 업로드)
// ============================================================
async function handleShippingImport(req, res) {
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows) || rows.length === 0) return fail(res, '업로드할 데이터가 없습니다');

  // 배송준비 상태 주문만 대상
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_no, name, phone, status, tracking_no')
    .eq('status', '배송준비');
  if (error) return fail(res, error.message, 500);

  let success = 0, skipped = 0, failed = 0;
  const details = [];

  for (const row of rows) {
    const [trackingNo, name, phone] = row;
    if (!trackingNo || !name) { skipped++; details.push({ name: name || '(빈)', reason: '운송장 또는 이름 없음' }); continue; }

    // phone 정규화: - 제거, 앞 7자리
    const normalizePhone = (p) => (p || '').replace(/-/g, '').slice(0, 7);
    const rowPhone7 = normalizePhone(phone);

    // 매칭: 이름 + 전화 앞 7자리
    const matched = orders.find(o =>
      o.name === name && normalizePhone(o.phone) === rowPhone7
    );

    if (!matched) {
      skipped++;
      details.push({ name, phone, reason: '매칭 주문 없음' });
      continue;
    }

    try {
      // 주문 상태 업데이트
      await supabaseAdmin.from('orders')
        .update({ status: '배송완료', tracking_no: String(trackingNo), tracking_carrier: '로젠택배' })
        .eq('id', matched.id);

      // 미배송 품목 재고 차감 + 상태 갱신
      const { data: pendingItems } = await supabaseAdmin.from('order_items')
        .select('*').eq('order_id', matched.id)
        .not('status', 'in', '("배송완료")');
      if (pendingItems && pendingItems.length > 0) {
        for (const item of pendingItems) {
          await deductInventoryForItem(item);
        }
        const pendingIds = pendingItems.map(i => i.id);
        await supabaseAdmin.from('order_items')
          .update({ status: '배송완료', allocated_qty: 0, tracking_no: String(trackingNo), tracking_carrier: '로젠택배' })
          .in('id', pendingIds);
      }

      // 매칭된 주문은 다시 매칭하지 않도록 배열에서 제거
      const idx = orders.indexOf(matched);
      if (idx > -1) orders.splice(idx, 1);

      await writeLog(req._admin, 'STATUS_CHANGE', 'order', matched.order_no, { from: '배송준비', to: '배송완료', trackingNo: String(trackingNo) });
      success++;
      details.push({ name, orderNo: matched.order_no, trackingNo: String(trackingNo), result: '성공' });
    } catch (e) {
      failed++;
      details.push({ name, orderNo: matched.order_no, reason: e.message });
    }
  }

  return ok(res, { success, skipped, failed, details });
}

// ============================================================
//  MEMBERS (회원관리)
// ============================================================
async function handleMembers(req, res) {
  // POST: 회원 등록
  if (req.method === 'POST') {
    const { name, phone, password, nickname, zipcode, address, addressDetail } = req.body;
    if (!name || !phone) return fail(res, '이름과 전화번호는 필수입니다');

    const { data: existing } = await supabaseAdmin.from('users').select('id').eq('phone', phone).single();
    if (existing) return fail(res, '이미 가입된 전화번호입니다', 409);

    const userData = { name, phone, password: password || '0000' };
    if (nickname) userData.nickname = nickname;
    if (zipcode) userData.zipcode = zipcode;
    if (address) userData.address = address;
    if (addressDetail) userData.address_detail = addressDetail;

    const { data: user, error } = await supabaseAdmin.from('users').insert(userData).select('id, name, phone, nickname').single();
    if (error) return fail(res, error.message, 500);
    await writeLog(req._admin, 'CREATE', 'member', user.id, { name, phone });
    return ok(res, { member: user }, 201);
  }

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
      nickname: u.nickname || '',
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
  // PATCH: 회원 수정
  if (req.method === 'PATCH') {
    const { name, phone, nickname, zipcode, address, addressDetail, role } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (nickname !== undefined) updates.nickname = nickname;
    if (zipcode !== undefined) updates.zipcode = zipcode;
    if (address !== undefined) updates.address = address;
    if (addressDetail !== undefined) updates.address_detail = addressDetail;
    if (role !== undefined) updates.role = role;

    if (Object.keys(updates).length === 0) return fail(res, '수정할 항목이 없습니다');

    const { data: user, error } = await supabaseAdmin.from('users').update(updates).eq('id', id).select('id, name, phone, nickname').single();
    if (error) return fail(res, error.message, 500);
    await writeLog(req._admin, 'UPDATE', 'member', id, updates);
    return ok(res, { member: user });
  }

  // DELETE: 회원 삭제
  if (req.method === 'DELETE') {
    const { data: delUser } = await supabaseAdmin.from('users').select('name, phone').eq('id', id).single();
    const { error } = await supabaseAdmin.from('users').delete().eq('id', id);
    if (error) return fail(res, error.message, 500);
    await writeLog(req._admin, 'DELETE', 'member', id, { name: delUser?.name, phone: delUser?.phone });
    return ok(res, { message: '회원이 삭제되었습니다' });
  }

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
      nickname: user.nickname || '',
      phone: user.phone,
      role: user.role,
      zipcode: user.zipcode || '',
      address: user.address || '',
      addressDetail: user.address_detail || '',
      addressFull: [user.zipcode, user.address, user.address_detail].filter(Boolean).join(' ') || '',
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
    await writeLog(req._admin, 'CREATE', 'vendor', data.id, { name });
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
    await writeLog(req._admin, 'UPDATE', 'vendor', id, { name: name || undefined });
    return ok(res, { id: parseInt(id) });
  }

  if (req.method === 'DELETE') {
    const { data: delV } = await supabaseAdmin.from('vendors').select('name').eq('id', id).single();
    const { error } = await supabaseAdmin.from('vendors').delete().eq('id', id);
    if (error) return fail(res, error.message, 500);
    await writeLog(req._admin, 'DELETE', 'vendor', id, { name: delV?.name });
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
          sizeName: i.size_name, qty: i.qty, costPrice: i.cost_price,
          subtotal: i.subtotal || (i.qty || 0) * (i.cost_price || 0),
          receivedQty: i.received_qty || 0,
        })),
      }
    });
  }

  if (req.method === 'PATCH') {
    const { status, memo, items, receivedItems } = req.body;
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
          received_qty: i.receivedQty || 0,
        }));
        await supabaseAdmin.from('purchase_order_items').insert(poItems);
      }
      // total_amount 재계산
      update.total_amount = items.reduce((s, i) => s + (i.qty || 1) * (i.costPrice || 0), 0);
    }

    // receivedItems: 입고 수량 업데이트 [{id, receivedQty}]
    if (receivedItems && Array.isArray(receivedItems)) {
      for (const ri of receivedItems) {
        if (ri.id && ri.receivedQty !== undefined) {
          await supabaseAdmin.from('purchase_order_items')
            .update({ received_qty: ri.receivedQty })
            .eq('id', ri.id);
        }
      }
    }

    const { error } = await supabaseAdmin.from('purchase_orders').update(update).eq('id', id);
    if (error) return fail(res, error.message, 500);

    // 입고중/입고완료 상태 변경 시: 재고 반영 + 고객별 FIFO 배정 실행
    let allocationResult = null;
    let inventoryResult = null;
    if (status === '입고중' || status === '입고완료') {
      // 입고 수량을 재고에 반영
      inventoryResult = await updateInventoryFromPO(parseInt(id));
      // 고객별 FIFO 배정
      allocationResult = await allocateReceivedToOrders(parseInt(id));
    }

    return ok(res, { id: parseInt(id), allocation: allocationResult, inventory: inventoryResult });
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
  query = query.neq('status', '결제취소');
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
      .select('total').neq('status', '결제취소')
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

    // 배정 고객 정보 조회
    const productIds = (data || []).map(inv => inv.product_id).filter(Boolean);
    let allocMap = {};
    if (productIds.length > 0) {
      const { data: allocItems } = await supabaseAdmin
        .from('order_items')
        .select('product_id, color, size, qty, allocated_qty, order_id, orders(order_no, name, status)')
        .in('product_id', productIds)
        .gt('allocated_qty', 0);
      (allocItems || []).forEach(ai => {
        const key = `${ai.product_id}|${ai.color || ''}|${ai.size || ''}`;
        if (!allocMap[key]) allocMap[key] = [];
        allocMap[key].push({
          orderNo: ai.orders ? ai.orders.order_no : '',
          customerName: ai.orders ? ai.orders.name : '',
          orderStatus: ai.orders ? ai.orders.status : '',
          allocatedQty: ai.allocated_qty || 0,
          orderQty: ai.qty,
        });
      });
    }

    const inventory = (data || []).map(inv => {
      const key = `${inv.product_id}|${inv.color_name || ''}|${inv.size_name || ''}`;
      const allocations = allocMap[key] || [];
      const allocatedTotal = allocations.reduce((s, a) => s + a.allocatedQty, 0);
      return {
        id: inv.id, productId: inv.product_id,
        productName: inv.products ? inv.products.name : '',
        colorName: inv.color_name, sizeName: inv.size_name,
        stockQty: inv.stock_qty,
        allocatedQty: allocatedTotal,
        freeQty: Math.max(0, inv.stock_qty - allocatedTotal),
        allocations,
      };
    });
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

  if (req.method === 'DELETE') {
    const { data: inv } = await supabaseAdmin.from('inventory').select('stock_qty').eq('id', id).single();
    if (!inv) return fail(res, '재고를 찾을 수 없습니다', 404);
    if (inv.stock_qty > 0) return fail(res, '재고가 0인 항목만 삭제할 수 있습니다');
    // 관련 이력 삭제 후 재고 삭제
    await supabaseAdmin.from('inventory_log').delete().eq('inventory_id', id);
    const { error } = await supabaseAdmin.from('inventory').delete().eq('id', id);
    if (error) return fail(res, error.message, 500);
    return ok(res, { deleted: true });
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
  let orderQuery = supabaseAdmin.from('orders').select('id, user_id, name, total, created_at').neq('status', '결제취소');
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
    await writeLog(req._admin, 'UPDATE', 'settings', key, {});
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

// ============================================================
//  CHAT (내부 채팅)
// ============================================================
const CHAT_PASSWORD = '0486';

async function handleChat(req, res) {
  const user = getUserFromRequest(req);
  if (!user) return fail(res, '인증 필요', 401);

  // 채팅 비밀번호 확인
  if (req.method === 'POST' && req.body && req.body.action === 'verify-password') {
    if (req.body.password === CHAT_PASSWORD) {
      return ok(res, { verified: true });
    }
    return fail(res, '비밀번호가 일치하지 않습니다', 401);
  }

  if (req.method === 'GET') {
    const { after, page = '1', limit = '50' } = req.query || {};

    // 폴링: 특정 시점 이후 신규 메시지만
    if (after) {
      const { data, error } = await supabaseAdmin
        .from('chat_messages')
        .select('*')
        .gt('created_at', after)
        .order('created_at', { ascending: true });
      if (error) return fail(res, error.message, 500);
      const messages = (data || []).map(m => ({
        id: m.id, senderId: m.sender_id, senderName: m.sender_name,
        message: m.message, imageUrl: m.image_url, isRead: m.is_read, createdAt: m.created_at,
      }));
      return ok(res, { messages });
    }

    // 페이지네이션 조회
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const { data, error, count } = await supabaseAdmin
      .from('chat_messages')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);
    if (error) return fail(res, error.message, 500);

    const messages = (data || []).reverse().map(m => ({
      id: m.id, senderId: m.sender_id, senderName: m.sender_name,
      message: m.message, imageUrl: m.image_url, isRead: m.is_read, createdAt: m.created_at,
    }));
    return ok(res, { messages, total: count || 0, page: pageNum, limit: limitNum });
  }

  if (req.method === 'POST') {
    const { message, imageUrl } = req.body;
    if (!message && !imageUrl) return fail(res, '메시지 또는 이미지를 입력해주세요');

    const { data, error } = await supabaseAdmin.from('chat_messages')
      .insert({ sender_id: user.id, sender_name: user.name, message: message || '', image_url: imageUrl || null })
      .select('id, created_at').single();
    if (error) return fail(res, error.message, 500);
    return ok(res, { id: data.id, createdAt: data.created_at }, 201);
  }

  if (req.method === 'PATCH') {
    // 상대 메시지 읽음 처리
    const { error } = await supabaseAdmin.from('chat_messages')
      .update({ is_read: true })
      .neq('sender_id', user.id)
      .eq('is_read', false);
    if (error) return fail(res, error.message, 500);
    return ok(res, { success: true });
  }

  if (req.method === 'DELETE') {
    const msgId = req.query.path ? (Array.isArray(req.query.path) ? req.query.path[1] : req.query.path.split('/')[1]) : null;
    // 전체삭제
    if (msgId === 'all') {
      const { error } = await supabaseAdmin.from('chat_messages').delete().gte('id', 0);
      if (error) return fail(res, error.message, 500);
      return ok(res, { deleted: true, all: true });
    }
    // 선택삭제 (복수 ID: comma 구분)
    if (msgId && msgId.includes(',')) {
      const ids = msgId.split(',').map(Number).filter(n => !isNaN(n));
      const { error } = await supabaseAdmin.from('chat_messages').delete().in('id', ids);
      if (error) return fail(res, error.message, 500);
      return ok(res, { deleted: true, count: ids.length });
    }
    // 단일 삭제
    if (!msgId) return fail(res, '메시지 ID가 필요합니다');
    const { error } = await supabaseAdmin.from('chat_messages').delete().eq('id', msgId);
    if (error) return fail(res, error.message, 500);
    return ok(res, { deleted: true });
  }

  return fail(res, 'Method not allowed', 405);
}

// ============================================================
//  AFTER SERVICE (A/S 관리)
// ============================================================
async function handleAfterServices(req, res) {
  if (req.method === 'GET') {
    const { status, search, lookupOrder, page = '1', limit = '20' } = req.query || {};

    // 주문번호로 주문+상품 조회 (접수 시 사용)
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
      .from('after_services')
      .select('*, orders(order_no)', { count: 'exact' })
      .order('id', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (status && status !== 'all') query = query.eq('status', status);
    if (search) {
      query = query.or(`as_no.ilike.%${search}%,customer_name.ilike.%${search}%,product_name.ilike.%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) return fail(res, error.message, 500);

    let result = (data || []).map(r => ({
      id: r.id, asNo: r.as_no, orderId: r.order_id,
      orderNo: r.orders ? r.orders.order_no : '',
      customerName: r.customer_name, customerPhone: r.customer_phone,
      productName: r.product_name, color: r.color, size: r.size,
      type: r.type, status: r.status, description: r.description, memo: r.memo,
      createdAt: r.created_at,
    }));

    // 주문번호 검색 (결과 없을 때)
    if (search && result.length === 0) {
      let q2 = supabaseAdmin.from('after_services')
        .select('*, orders!inner(order_no)', { count: 'exact' })
        .ilike('orders.order_no', `%${search}%`)
        .order('id', { ascending: false })
        .range(offset, offset + limitNum - 1);
      if (status && status !== 'all') q2 = q2.eq('status', status);
      const { data: d2, count: c2 } = await q2;
      result = (d2 || []).map(r => ({
        id: r.id, asNo: r.as_no, orderId: r.order_id,
        orderNo: r.orders ? r.orders.order_no : '',
        customerName: r.customer_name, customerPhone: r.customer_phone,
        productName: r.product_name, color: r.color, size: r.size,
        type: r.type, status: r.status, description: r.description, memo: r.memo,
        createdAt: r.created_at,
      }));
      return ok(res, { afterServices: result, total: c2 || 0, page: pageNum, limit: limitNum });
    }

    return ok(res, { afterServices: result, total: count, page: pageNum, limit: limitNum });
  }

  if (req.method === 'POST') {
    const { orderId, customerName, customerPhone, productName, color, size, type, description, memo, images } = req.body;
    if (!customerName) return fail(res, '고객명을 입력해주세요');
    if (!productName) return fail(res, '상품명을 입력해주세요');

    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const { count } = await supabaseAdmin.from('after_services').select('id', { count: 'exact', head: true }).ilike('as_no', `AS-${dateStr}%`);
    const asNo = `AS-${dateStr}-${String((count || 0) + 1).padStart(3, '0')}`;

    const { data, error } = await supabaseAdmin.from('after_services')
      .insert({
        as_no: asNo, order_id: orderId || null,
        customer_name: customerName, customer_phone: customerPhone || '',
        product_name: productName, color: color || '', size: size || '',
        type: type || '수선', status: '접수',
        description: description || '', memo: memo || '',
      })
      .select('id').single();
    if (error) return fail(res, error.message, 500);

    // 이미지 저장
    if (images && images.length > 0) {
      await supabaseAdmin.from('after_service_images').insert(
        images.map((url, i) => ({ after_service_id: data.id, image_url: url, sort_order: i }))
      );
    }

    return ok(res, { id: data.id, asNo }, 201);
  }

  return fail(res, 'Method not allowed', 405);
}

async function handleAfterServiceDetail(req, res, id) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('after_services')
      .select('*, orders(order_no, name, total, status)')
      .eq('id', id).single();
    if (error || !data) return fail(res, 'A/S 접수를 찾을 수 없습니다', 404);

    const { data: images } = await supabaseAdmin.from('after_service_images')
      .select('*').eq('after_service_id', id).order('sort_order', { ascending: true });

    return ok(res, {
      asData: {
        id: data.id, asNo: data.as_no, orderId: data.order_id,
        orderNo: data.orders ? data.orders.order_no : '',
        orderName: data.orders ? data.orders.name : '',
        orderTotal: data.orders ? data.orders.total : 0,
        orderStatus: data.orders ? data.orders.status : '',
        customerName: data.customer_name, customerPhone: data.customer_phone,
        productName: data.product_name, color: data.color, size: data.size,
        type: data.type, status: data.status,
        description: data.description, memo: data.memo,
        createdAt: data.created_at,
        images: (images || []).map(img => ({ id: img.id, imageUrl: img.image_url, sortOrder: img.sort_order })),
      }
    });
  }

  if (req.method === 'PATCH') {
    const { status, memo, description, images } = req.body;
    const update = { updated_at: new Date().toISOString() };
    if (status) update.status = status;
    if (memo !== undefined) update.memo = memo;
    if (description !== undefined) update.description = description;

    const { error } = await supabaseAdmin.from('after_services').update(update).eq('id', id);
    if (error) return fail(res, error.message, 500);

    // 이미지 업데이트 (전체 교체)
    if (images !== undefined) {
      await supabaseAdmin.from('after_service_images').delete().eq('after_service_id', id);
      if (images.length > 0) {
        await supabaseAdmin.from('after_service_images').insert(
          images.map((url, i) => ({ after_service_id: parseInt(id), image_url: url, sort_order: i }))
        );
      }
    }

    return ok(res, { id: parseInt(id) });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabaseAdmin.from('after_services').delete().eq('id', id);
    if (error) return fail(res, error.message, 500);
    return ok(res, { deleted: true });
  }

  return fail(res, 'Method not allowed', 405);
}
