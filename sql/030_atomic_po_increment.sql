-- PO 품목 수량 원자적 증가 (race condition 방지)
-- 동시 실행 시 read-then-write 대신 DB 레벨에서 atomic increment
CREATE OR REPLACE FUNCTION increment_po_item_qty(p_item_id int, p_add_qty int)
RETURNS TABLE(new_qty int, new_subtotal bigint) AS $$
  UPDATE purchase_order_items
  SET qty = qty + p_add_qty,
      subtotal = (qty + p_add_qty) * cost_price
  WHERE id = p_item_id
  RETURNING qty, subtotal;
$$ LANGUAGE sql;
