-- 022_backup_rpc.sql: 백업 복원 후 시퀀스 리셋 RPC

CREATE OR REPLACE FUNCTION reset_all_sequences()
RETURNS void AS $$
DECLARE
  r RECORD;
  max_val BIGINT;
BEGIN
  -- information_schema에서 nextval 기본값을 가진 컬럼 찾아서 MAX(id)+1로 setval
  FOR r IN
    SELECT
      tc.table_name,
      tc.column_name,
      pg_get_serial_sequence(tc.table_name, tc.column_name) AS seq_name
    FROM information_schema.columns tc
    WHERE tc.table_schema = 'public'
      AND tc.column_default LIKE 'nextval%'
  LOOP
    IF r.seq_name IS NOT NULL THEN
      EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM %I', r.column_name, r.table_name) INTO max_val;
      PERFORM setval(r.seq_name, GREATEST(max_val + 1, 1), false);
    END IF;
  END LOOP;

  -- order_seq 별도 리셋 (orders.order_no에서 최대값 추출)
  BEGIN
    SELECT COALESCE(MAX(
      CASE
        WHEN order_no ~ '-(\d+)$'
        THEN (regexp_match(order_no, '-(\d+)$'))[1]::BIGINT
        ELSE 0
      END
    ), 0) INTO max_val FROM orders;
    PERFORM setval('order_seq', GREATEST(max_val + 1, 1), false);
  EXCEPTION WHEN OTHERS THEN
    -- order_seq가 없으면 무시
    NULL;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
