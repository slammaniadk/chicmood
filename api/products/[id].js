const { supabase } = require('../_lib/supabase');
const { ok, fail, handleCors } = require('../_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);

  const { id } = req.query;

  const { data: p, error } = await supabase
    .from('products')
    .select(`
      id, name, price, wholesale_price, original_price, discount, description, material, size, category, length_options,
      product_images ( image_url, sort_order ),
      product_colors ( name, hex_code, sort_order ),
      broadcast_products ( broadcast_id, broadcasts:broadcast_id ( id, status ) )
    `)
    .eq('id', id)
    .single();

  if (error || !p) return fail(res, '상품을 찾을 수 없습니다', 404);

  // 라이브 방송 우선, 없으면 가장 최신(큰 ID) 방송
  const bps = (p.broadcast_products || []);
  const liveBp = bps.find(bp => bp.broadcasts?.status === 'live');
  const latestBp = bps.sort((a, b) => b.broadcast_id - a.broadcast_id)[0];
  const bestBp = liveBp || latestBp;

  const result = {
    id: p.id,
    name: p.name,
    price: p.wholesale_price || p.price,
    originalPrice: p.original_price,
    discount: p.discount,
    description: p.description,
    material: p.material,
    images: (p.product_images || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(i => i.image_url),
    colors: (p.product_colors || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(c => ({ name: c.name, hex: c.hex_code })),
    size: p.size || '',
    category: p.category || '',
    lengthOptions: p.length_options || '',
    broadcastId: bestBp?.broadcast_id || null,
  };

  return ok(res, result);
};
