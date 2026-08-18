const { supabase } = require('../_lib/supabase');
const { ok, fail, handleCors } = require('../_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);

  const { id } = req.query;

  const { data: p, error } = await supabase
    .from('products')
    .select(`
      id, name, price, original_price, discount, description, material, size,
      product_images ( image_url, sort_order ),
      product_colors ( name, hex_code, sort_order ),
      broadcast_products ( broadcast_id )
    `)
    .eq('id', id)
    .single();

  if (error || !p) return fail(res, '상품을 찾을 수 없습니다', 404);

  const result = {
    id: p.id,
    name: p.name,
    price: p.price,
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
    broadcastId: p.broadcast_products?.[0]?.broadcast_id || null,
  };

  return ok(res, result);
};
