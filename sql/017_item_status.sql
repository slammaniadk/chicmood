-- 품목별 상태 관리 컬럼 추가
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS status TEXT DEFAULT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tracking_no TEXT DEFAULT '';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tracking_carrier TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_order_items_status ON order_items(status);

-- 기존 데이터 마이그레이션 (기존 주문 상태를 품목 상태로 전파)
-- status NULL = 결제 전 상태(입금대기/확인요청), 주문 상태 상속
-- 품목 상태값: 결제완료, 배정완료, 배송준비, 배송중, 송장완료, 취소
UPDATE order_items oi SET status = CASE
  WHEN o.status = '결제완료' AND oi.allocated_qty >= oi.qty THEN '배정완료'
  WHEN o.status = '결제완료' THEN '결제완료'
  WHEN o.status = '배송준비' THEN '배송준비'
  WHEN o.status = '배송중' THEN '배송중'
  WHEN o.status = '송장완료' THEN '송장완료'
  WHEN o.status = '취소' THEN '취소'
  ELSE NULL
END FROM orders o WHERE oi.order_id = o.id;
