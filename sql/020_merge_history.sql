-- 주문 병합 이력 테이블 (병합해제 기능을 위한 스냅샷 저장)
CREATE TABLE IF NOT EXISTS merge_history (
  id            SERIAL PRIMARY KEY,
  target_id     UUID NOT NULL,
  merged_by     UUID,
  merged_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  unmerged_at   TIMESTAMPTZ,
  unmerged_by   UUID,
  source_orders JSONB NOT NULL  -- [{order_id, order_no, name, phone, ..., item_ids:[]}]
);
CREATE INDEX IF NOT EXISTS idx_merge_history_target ON merge_history(target_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS merge_history_id INTEGER
  REFERENCES merge_history(id) ON DELETE SET NULL;
