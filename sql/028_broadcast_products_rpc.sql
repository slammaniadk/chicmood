-- 방송 상품 교체 RPC (트랜잭션 보장)
-- DELETE + INSERT가 하나의 트랜잭션으로 실행되어 중간 실패 시 자동 롤백
CREATE OR REPLACE FUNCTION replace_broadcast_products(
  p_broadcast_id INTEGER,
  p_product_ids  INTEGER[]
) RETURNS JSONB AS $$
DECLARE
  old_ids INTEGER[];
BEGIN
  SELECT array_agg(product_id ORDER BY sort_order) INTO old_ids
    FROM broadcast_products WHERE broadcast_id = p_broadcast_id;

  DELETE FROM broadcast_products WHERE broadcast_id = p_broadcast_id;

  IF array_length(p_product_ids, 1) IS NOT NULL THEN
    INSERT INTO broadcast_products (broadcast_id, product_id, sort_order)
    SELECT p_broadcast_id, pid, (row_number() OVER ())::int - 1
      FROM unnest(p_product_ids) AS pid;
  END IF;

  RETURN jsonb_build_object(
    'old_product_ids', COALESCE(to_jsonb(old_ids), '[]'::jsonb),
    'new_product_ids', to_jsonb(p_product_ids)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
