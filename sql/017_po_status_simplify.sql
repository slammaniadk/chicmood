-- 017_po_status_simplify.sql: 발주 상태를 발주대기/입고완료 두 단계로 축소

-- 기존 데이터 마이그레이션: 중간 단계는 발주대기로, 취소는 삭제 대신 발주대기로 복원
UPDATE purchase_orders SET status = '발주대기' WHERE status IN ('발주완료', '입고중', '취소');

-- 기존 CHECK 제약조건 삭제 후 재생성
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK (status IN ('발주대기', '입고완료'));
