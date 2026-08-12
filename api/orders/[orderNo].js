const { supabaseAdmin } = require('../_lib/supabase');
const { ok, fail, handleCors } = require('../_lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'PATCH') return fail(res, 'Method not allowed', 405);

  const { orderNo } = req.query;
  const { status } = req.body;

  // 허용되는 상태 전이: 입금대기 → 확인요청
  const ALLOWED_TRANSITIONS = {
    '입금대기': '확인요청',
  };

  // 현재 주문 조회
  const { data: order, error: oErr } = await supabaseAdmin
    .from('orders')
    .select('id, status')
    .eq('order_no', orderNo)
    .single();

  if (oErr || !order) return fail(res, '주문을 찾을 수 없습니다', 404);

  const expectedNext = ALLOWED_TRANSITIONS[order.status];
  if (!expectedNext || expectedNext !== status) {
    return fail(res, `현재 상태(${order.status})에서 ${status}(으)로 변경할 수 없습니다`);
  }

  const { data: updated, error: uErr } = await supabaseAdmin
    .from('orders')
    .update({ status })
    .eq('id', order.id)
    .select('order_no, status')
    .single();

  if (uErr) return fail(res, uErr.message, 500);

  return ok(res, { orderNo: updated.order_no, status: updated.status });
};
