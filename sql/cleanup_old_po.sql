-- ============================================================
-- 종료된 방송에 연결된 잔여 "발주대기" PO 확인 및 정리
-- Ver 2.8.8 (2026-09-13)
-- ============================================================

-- 1) 확인: 종료된 방송에 연결된 발주대기 PO 목록
SELECT po.id, po.po_no, po.status, po.broadcast_id,
       b.title AS broadcast_title, b.status AS broadcast_status,
       po.total_amount, po.created_at
FROM purchase_orders po
LEFT JOIN broadcasts b ON po.broadcast_id = b.id
WHERE po.status = '발주대기'
  AND b.status = 'ended'
ORDER BY po.created_at;

-- 2) 확인: 위 PO에 포함된 품목 상세
SELECT poi.purchase_order_id, po.po_no, poi.product_name,
       poi.color_name, poi.size_name, poi.qty, poi.cost_price
FROM purchase_order_items poi
JOIN purchase_orders po ON poi.purchase_order_id = po.id
JOIN broadcasts b ON po.broadcast_id = b.id
WHERE po.status = '발주대기'
  AND b.status = 'ended'
ORDER BY po.po_no, poi.product_name;

-- ============================================================
-- 아래는 확인 후 필요시 수동 실행 (주석 해제하여 사용)
-- ============================================================

-- 3) 종료된 방송의 발주대기 PO를 '취소'로 변경
-- UPDATE purchase_orders
-- SET status = '취소', updated_at = NOW()
-- WHERE status = '발주대기'
--   AND broadcast_id IN (
--     SELECT id FROM broadcasts WHERE status = 'ended'
--   );
