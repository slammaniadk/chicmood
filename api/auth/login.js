const { supabaseAdmin } = require('../_lib/supabase');
const { signToken, getUserFromRequest } = require('../_lib/auth');
const { ok, fail, handleCors } = require('../_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  // PATCH: 프로필 수정
  if (req.method === 'PATCH') {
    const tokenUser = getUserFromRequest(req);
    if (!tokenUser || !tokenUser.id) return fail(res, '로그인이 필요합니다', 401);

    const { nickname, zipcode, addrBase, addrDetail } = req.body;
    const updates = {};
    if (nickname !== undefined) updates.nickname = nickname;
    if (zipcode !== undefined) updates.zipcode = zipcode;
    if (addrBase !== undefined) updates.address = addrBase;
    if (addrDetail !== undefined) updates.address_detail = addrDetail;

    if (Object.keys(updates).length === 0) return fail(res, '수정할 항목이 없습니다');

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', tokenUser.id)
      .select('id, name, phone, role, nickname, zipcode, address, address_detail')
      .single();

    if (error) return fail(res, error.message, 500);

    return ok(res, {
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role || 'user',
        nickname: user.nickname || '',
        zipcode: user.zipcode || '',
        addrBase: user.address || '',
        addrDetail: user.address_detail || '',
      },
    });
  }

  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);

  const { phone, password } = req.body;

  if (!phone || !password) {
    return fail(res, '전화번호와 비밀번호를 입력해주세요');
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, name, phone, password, role, nickname, zipcode, address, address_detail')
    .eq('phone', phone)
    .single();

  if (error || !user || user.password !== password) {
    return fail(res, '전화번호 또는 비밀번호가 일치하지 않습니다', 401);
  }

  const token = signToken({ id: user.id, name: user.name, phone: user.phone, role: user.role || 'user' });

  return ok(res, {
    token,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role || 'user',
      nickname: user.nickname || '',
      zipcode: user.zipcode || '',
      addrBase: user.address || '',
      addrDetail: user.address_detail || '',
    },
  });
};
