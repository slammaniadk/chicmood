const { supabase } = require('../_lib/supabase');
const { ok, fail, handleCors } = require('../_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);

  const { id } = req.query;

  const { data: b, error } = await supabase
    .from('broadcasts')
    .select(`
      id, title, date_text, status, description,
      broadcast_products (
        sort_order,
        products:product_id (
          id, name, price, wholesale_price, original_price, discount,
          product_images ( image_url, sort_order ),
          product_colors ( name, hex_code, sort_order )
        )
      )
    `)
    .eq('id', id)
    .single();

  if (error || !b) return fail(res, '방송을 찾을 수 없습니다', 404);

  const products = (b.broadcast_products || [])
    .sort((a, c) => a.sort_order - c.sort_order)
    .map(bp => {
      const p = bp.products;
      if (!p) return null;
      return {
        id: p.id,
        name: p.name,
        price: p.wholesale_price || p.price,
        originalPrice: p.original_price,
        discount: p.discount,
        images: (p.product_images || [])
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(i => i.image_url),
        colors: (p.product_colors || [])
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(c => ({ name: c.name, hex: c.hex_code })),
      };
    })
    .filter(Boolean);

  return ok(res, {
    id: b.id,
    title: b.title,
    date: b.date_text,
    status: b.status,
    description: b.description,
    products,
  });
};
