-- 013_order_broadcast.sql: 주문에 방송 ID 연결
-- 주문이 어떤 방송을 통해 들어왔는지 추적하기 위해 broadcast_id 컬럼 추가

ALTER TABLE orders ADD COLUMN IF NOT EXISTS broadcast_id INTEGER REFERENCES broadcasts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_broadcast_id ON orders(broadcast_id);
