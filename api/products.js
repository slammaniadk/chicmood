const { supabase } = require('./_lib/supabase');
const { ok, fail, handleCors } = require('./_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);

  const { data: products, error } = await supabase
    .from('products')
    .select(`
      id, name, price, original_price, discount, description, material,
      product_images ( image_url, sort_order ),
      product_colors ( name, hex_code, sort_order )
    `)
    .order('id');

  if (error) return fail(res, error.message, 500);

  const result = products.map(p => ({
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
  }));

  return ok(res, result);
};
