const { supabaseAdmin } = require('../_lib/supabase');
const { signToken } = require('../_lib/auth');
const { ok, fail, handleCors } = require('../_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);

  const { name, phone, password } = req.body;

  if (!name || !phone || !password) {
    return fail(res, '이름, 전화번호, 비밀번호는 필수입니다');
  }
  if (!/^\d{4}$/.test(password)) {
    return fail(res, '비밀번호는 숫자 4자리로 입력해주세요');
  }

  // 전화번호 중복 체크
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('phone', phone)
    .single();

  if (existing) {
    return fail(res, '이미 가입된 전화번호입니다', 409);
  }

  // 회원 생성
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .insert({ name, phone, password })
    .select('id, name, phone')
    .single();

  if (error) return fail(res, error.message, 500);

  const token = signToken({ id: user.id, name: user.name, phone: user.phone, role: 'user' });

  return ok(res, {
    token,
    user: { name: user.name, phone: user.phone },
  }, 201);
};
