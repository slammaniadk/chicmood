const { supabase } = require('./_lib/supabase');
const { ok, fail, handleCors } = require('./_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return fail(res, 'Method not allowed', 405);

  const { data: broadcasts, error } = await supabase
    .from('broadcasts')
    .select(`
      id, title, date_text, status, description,
      broadcast_products (
        sort_order,
        products:product_id (
          id, name, price, original_price, discount,
          product_images ( image_url, sort_order )
        )
      )
    `)
    .order('id', { ascending: false });

  if (error) return fail(res, error.message, 500);

  const result = broadcasts.map(b => {
    const prods = (b.broadcast_products || [])
      .sort((a, c) => a.sort_order - c.sort_order)
      .map(bp => bp.products)
      .filter(Boolean);

    const productCount = prods.length;
    const maxDiscount = prods.length > 0 ? Math.max(...prods.map(p => p.discount)) : 0;
    const previewImages = prods
      .slice(0, 3)
      .map(p => {
        const imgs = (p.product_images || []).sort((a, b) => a.sort_order - b.sort_order);
        return imgs[0]?.image_url || null;
      })
      .filter(Boolean);

    return {
      id: b.id,
      title: b.title,
      date: b.date_text,
      status: b.status,
      description: b.description,
      productCount,
      maxDiscount,
      previewImages,
      productIds: prods.map(p => p.id),
    };
  });

  return ok(res, result);
};
