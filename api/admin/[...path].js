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
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  const [ordersRes, todayRes] = await Promise.all([
    supabaseAdmin.from('orders').select('status, total'),
    supabaseAdmin.from('orders').select('id, total').gte('created_at', todayStart).lt('created_at', todayEnd),
  ]);

  if (ordersRes.error) return fail(res, ordersRes.error.message, 500);

  const allOrders = ordersRes.data || [];
  const todayOrders = todayRes.data || [];

  const statusCounts = {};
  const statusTotals = {};
  let totalRevenue = 0;

  allOrders.forEach(o => {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    statusTotals[o.status] = (statusTotals[o.status] || 0) + o.total;
    totalRevenue += o.total;
  });

  return ok(res, {
    totalOrders: allOrders.length,
    totalRevenue,
    todayOrders: todayOrders.length,
    todayRevenue: todayOrders.reduce((s, o) => s + o.total, 0),
    statusCounts,
    statusTotals,
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
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limitNum - 1);

  if (status && status !== 'all') query = query.eq('status', status);
  if (search) query = query.or(`name.ilike.%${search}%,order_no.ilike.%${search}%,phone.ilike.%${search}%`);

  const { data: orders, error, count } = await query;
  if (error) return fail(res, error.message, 500);

  const orderIds = orders.map(o => o.id);
  let items = [];
  if (orderIds.length > 0) {
    const { data: itemsData } = await supabaseAdmin.from('order_items').select('*').in('order_id', orderIds);
    items = itemsData || [];
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
    createdAt: o.created_at,
    items: items.filter(i => i.order_id === o.id).map(i => ({
      name: i.name, color: i.color, size: i.size, qty: i.qty, price: i.price, subtotal: i.subtotal,
    })),
  }));

  return ok(res, { orders: result, total: count, page: pageNum, limit: limitNum });
}

// ============================================================
//  ORDER DETAIL (PATCH)
// ============================================================
async function handleOrderDetail(req, res, id) {
  if (req.method !== 'PATCH') return fail(res, 'Method not allowed', 405);

  const { status, trackingNo, trackingCarrier } = req.body;
  const validStatuses = ['입금대기', '확인요청', '결제완료', '배송중', '송장완료', '취소'];
  if (status && !validStatuses.includes(status)) return fail(res, `유효하지 않은 상태입니다: ${status}`);

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

  return ok(res, { id: data.id, orderNo: data.order_no, status: data.status, trackingNo: data.tracking_no, trackingCarrier: data.tracking_carrier });
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
      images: (p.product_images || []).sort((a, b) => a.sort_order - b.sort_order).map(img => img.image_url),
      colors: (p.product_colors || []).sort((a, b) => a.sort_order - b.sort_order).map(c => ({ name: c.name, hex: c.hex_code })),
    }));

    return ok(res, result);
  }

  if (req.method === 'POST') {
    const { name, price, originalPrice, discount, description, material, images, colors, vendorId, costPrice } = req.body;
    if (!name || !price) return fail(res, '상품명과 가격은 필수입니다');

    const insertData = { name, price, original_price: originalPrice || price, discount: discount || 0, description: description || '', material: material || '' };
    if (vendorId) insertData.vendor_id = vendorId;
    if (costPrice) insertData.cost_price = costPrice;

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
    const { name, price, originalPrice, discount, description, material, images, colors, vendorId, costPrice } = req.body;

    const update = {};
    if (name !== undefined) update.name = name;
    if (price !== undefined) update.price = price;
    if (originalPrice !== undefined) update.original_price = originalPrice;
    if (discount !== undefined) update.discount = discount;
    if (description !== undefined) update.description = description;
    if (material !== undefined) update.material = material;
    if (vendorId !== undefined) update.vendor_id = vendorId;
    if (costPrice !== undefined) update.cost_price = costPrice;

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
    const { data: broadcasts, error } = await supabaseAdmin
      .from('broadcasts')
      .select('*, broadcast_products(product_id)')
      .order('id', { ascending: false });

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
      .insert({ title, date_text: date || '', scheduled_at: scheduledAt || null, status: status || 'upcoming', description: description || '' })
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

  // 각 회원의 주문 수와 총 구매액 집계
  const userIds = users.map(u => u.id);
  let orderStats = {};
  if (userIds.length > 0) {
    const { data: orders } = await supabaseAdmin.from('orders').select('user_id, total').in('user_id', userIds);
    (orders || []).forEach(o => {
      if (!orderStats[o.user_id]) orderStats[o.user_id] = { count: 0, total: 0 };
      orderStats[o.user_id].count++;
      orderStats[o.user_id].total += o.total;
    });
  }

  const members = users.map(u => ({
    id: u.id,
    name: u.name,
    phone: u.phone,
    role: u.role,
    orderCount: (orderStats[u.id] || {}).count || 0,
    totalSpent: (orderStats[u.id] || {}).total || 0,
    createdAt: u.created_at,
  }));

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
    const { data: vendors, error } = await supabaseAdmin
      .from('vendors')
      .select('*')
      .order('id', { ascending: false });
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
    const { status, page = '1', limit = '20' } = req.query || {};
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabaseAdmin
      .from('purchase_orders')
      .select('*, vendors(name)', { count: 'exact' })
      .order('id', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (status && status !== 'all') query = query.eq('status', status);

    const { data, error, count } = await query;
    if (error) return fail(res, error.message, 500);

    const result = (data || []).map(po => ({
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
          id: i.id, productName: i.product_name, colorName: i.color_name,
          sizeName: i.size_name, qty: i.qty, costPrice: i.cost_price, subtotal: i.subtotal,
        })),
      }
    });
  }

  if (req.method === 'PATCH') {
    const { status, memo } = req.body;
    const update = {};
    if (status) {
      update.status = status;
      if (status === '발주완료') update.ordered_at = new Date().toISOString();
      if (status === '입고완료') update.completed_at = new Date().toISOString();
    }
    if (memo !== undefined) update.memo = memo;
    update.updated_at = new Date().toISOString();

    const { error } = await supabaseAdmin.from('purchase_orders').update(update).eq('id', id);
    if (error) return fail(res, error.message, 500);
    return ok(res, { id: parseInt(id) });
  }

  return fail(res, 'Method not allowed', 405);
}

// ============================================================
//  SALES (매출관리)
// ============================================================
async function handleSales(req, res) {
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);

  const { type = 'daily', from, to } = req.query || {};

  let query = supabaseAdmin.from('orders').select('id, total, status, created_at');
  // 취소 제외
  query = query.neq('status', '취소');
  if (from) query = query.gte('created_at', from + 'T00:00:00');
  if (to) query = query.lte('created_at', to + 'T23:59:59');

  const { data: orders, error } = await query.order('created_at', { ascending: false });
  if (error) return fail(res, error.message, 500);

  const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
  const orderCount = orders.length;
  const avgOrder = orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0;
  const summary = { totalRevenue, orderCount, avgOrder };

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
  } else if (type === 'broadcast') {
    const { data: broadcasts } = await supabaseAdmin.from('broadcasts').select('id, title, date_text').order('id', { ascending: false });
    rows = (broadcasts || []).map(b => ({ broadcastTitle: b.title, orderCount: 0, revenue: 0 }));
  }

  return ok(res, { summary, rows });
}

// ============================================================
//  INVENTORY (재고관리)
// ============================================================
async function handleInventory(req, res) {
  if (req.method === 'GET') {
    const { page = '1', limit = '30' } = req.query || {};
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const { data, error, count } = await supabaseAdmin
      .from('inventory')
      .select('*, products(name)', { count: 'exact' })
      .order('id', { ascending: false })
      .range(offset, offset + limitNum - 1);
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
  const { data, error } = await supabaseAdmin.from('inventory_log')
    .select('*').order('created_at', { ascending: false }).limit(100);
  if (error) return fail(res, error.message, 500);
  return ok(res, { logs: data || [] });
}

// ============================================================
//  RETURNS (반품/교환/취소)
// ============================================================
async function handleReturns(req, res) {
  if (req.method === 'GET') {
    const { status, page = '1', limit = '20' } = req.query || {};
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabaseAdmin
      .from('returns')
      .select('*, orders(order_no)', { count: 'exact' })
      .order('id', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (status && status !== 'all') query = query.eq('status', status);

    const { data, error, count } = await query;
    if (error) return fail(res, error.message, 500);

    const result = (data || []).map(r => ({
      id: r.id, returnNo: r.return_no, orderId: r.order_id,
      orderNo: r.orders ? r.orders.order_no : '',
      type: r.type, status: r.status, reason: r.reason,
      refundAmount: r.refund_amount, memo: r.memo, createdAt: r.created_at,
    }));
    return ok(res, { returns: result, total: count, page: pageNum, limit: limitNum });
  }

  if (req.method === 'POST') {
    const { orderNo, type, reason, refundAmount, memo } = req.body;
    if (!orderNo) return fail(res, '주문번호를 입력해주세요');
    if (!reason) return fail(res, '사유를 입력해주세요');

    // 주문 찾기
    const { data: order } = await supabaseAdmin.from('orders').select('id').eq('order_no', orderNo).single();
    if (!order) return fail(res, '해당 주문번호를 찾을 수 없습니다');

    // 접수번호 생성
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const { count } = await supabaseAdmin.from('returns').select('id', { count: 'exact', head: true }).ilike('return_no', `RET-${dateStr}%`);
    const returnNo = `RET-${dateStr}-${String((count || 0) + 1).padStart(3, '0')}`;

    const { data, error } = await supabaseAdmin.from('returns')
      .insert({ return_no: returnNo, order_id: order.id, type, status: '접수', reason, refund_amount: refundAmount || 0, memo: memo || '' })
      .select('id').single();
    if (error) return fail(res, error.message, 500);

    return ok(res, { id: data.id, returnNo }, 201);
  }

  return fail(res, 'Method not allowed', 405);
}

async function handleReturnDetail(req, res, id) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('returns')
      .select('*, orders(order_no), return_items(*)')
      .eq('id', id).single();
    if (error || !data) return fail(res, '접수를 찾을 수 없습니다', 404);

    return ok(res, {
      returnData: {
        id: data.id, returnNo: data.return_no, orderId: data.order_id,
        orderNo: data.orders ? data.orders.order_no : '',
        type: data.type, status: data.status, reason: data.reason,
        refundAmount: data.refund_amount, memo: data.memo, createdAt: data.created_at,
        items: (data.return_items || []).map(i => ({
          id: i.id, name: i.name, color: i.color, size: i.size, qty: i.qty, price: i.price,
        })),
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

  const { type = 'sales-ranking' } = req.query || {};
  let rows = [];

  if (type === 'sales-ranking') {
    const { data: items } = await supabaseAdmin.from('order_items').select('name, qty, subtotal');
    const grouped = {};
    (items || []).forEach(i => {
      if (!grouped[i.name]) grouped[i.name] = { totalQty: 0, revenue: 0 };
      grouped[i.name].totalQty += i.qty;
      grouped[i.name].revenue += i.subtotal;
    });
    rows = Object.entries(grouped).sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([productName, v]) => ({ productName, ...v }));
  } else if (type === 'customer') {
    const { data: orders } = await supabaseAdmin.from('orders').select('user_id, name, total').neq('status', '취소');
    const grouped = {};
    (orders || []).forEach(o => {
      const key = o.user_id || o.name;
      if (!grouped[key]) grouped[key] = { name: o.name, orderCount: 0, totalSpent: 0 };
      grouped[key].orderCount++;
      grouped[key].totalSpent += o.total;
    });
    rows = Object.values(grouped).sort((a, b) => b.totalSpent - a.totalSpent);
  } else if (type === 'broadcast') {
    const { data: broadcasts } = await supabaseAdmin
      .from('broadcasts')
      .select('id, title, date_text, status, broadcast_products(product_id)')
      .order('id', { ascending: false });
    rows = (broadcasts || []).map(b => ({
      title: b.title, date: b.date_text, status: b.status,
      productCount: (b.broadcast_products || []).length,
    }));
  }

  return ok(res, { rows });
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

  return fail(res, 'Method not allowed', 405);
}

// ============================================================
//  LOGS (활동 로그)
// ============================================================
async function handleLogs(req, res) {
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);

  const { limit = '50' } = req.query || {};
  const limitNum = Math.min(200, Math.max(1, parseInt(limit)));

  const { data, error } = await supabaseAdmin.from('admin_logs')
    .select('*').order('created_at', { ascending: false }).limit(limitNum);
  if (error) return fail(res, error.message, 500);

  const logs = (data || []).map(l => ({
    id: l.id, userId: l.user_id, userName: l.user_name,
    action: l.action, targetType: l.target_type, targetId: l.target_id,
    detail: l.detail, createdAt: l.created_at,
  }));
  return ok(res, { logs });
}
