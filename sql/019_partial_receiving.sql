-- 019_partial_receiving.sql: 발주 상태에 '부분입고' 추가
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK (status IN ('발주대기', '부분입고', '입고완료'));
