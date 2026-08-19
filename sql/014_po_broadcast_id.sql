-- purchase_orders에 broadcast_id 컬럼 추가 (메모의 [BC:x] 태그 대체)
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS broadcast_id INTEGER REFERENCES broadcasts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_broadcast_id ON purchase_orders(broadcast_id);
