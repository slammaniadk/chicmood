-- 주문관리 상태값 정리 마이그레이션
-- 입금대기/확인요청 → 입금확인, 배송중/송장완료 → 배송완료, 취소 → 결제취소

UPDATE orders SET status = '입금확인' WHERE status = '입금대기';
UPDATE orders SET status = '입금확인' WHERE status = '확인요청';
UPDATE orders SET status = '배송완료' WHERE status = '배송중';
UPDATE orders SET status = '배송완료' WHERE status = '송장완료';
UPDATE orders SET status = '결제취소' WHERE status = '취소';
UPDATE order_items SET status = '배송완료' WHERE status = '배송중';
UPDATE order_items SET status = '배송완료' WHERE status = '송장완료';
UPDATE order_items SET status = '결제취소' WHERE status = '취소';
UPDATE order_items SET status = '결제완료' WHERE status = '배정완료';
