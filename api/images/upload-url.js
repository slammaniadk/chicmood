const { supabaseAdmin } = require('../_lib/supabase');
const { ok, fail, handleCors } = require('../_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);

  const { filename, contentType } = req.body;

  if (!filename) {
    return fail(res, 'filename은 필수입니다');
  }

  const ext = filename.split('.').pop();
  const path = `uploads/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { data, error } = await supabaseAdmin.storage
    .from('product-images')
    .createSignedUploadUrl(path);

  if (error) return fail(res, error.message, 500);

  // 공개 URL 생성
  const { data: publicData } = supabaseAdmin.storage
    .from('product-images')
    .getPublicUrl(path);

  return ok(res, {
    signedUrl: data.signedUrl,
    token: data.token,
    path,
    publicUrl: publicData.publicUrl,
  });
};
