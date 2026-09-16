-- 026: 발주-주문 연결 테이블 (추적용)
-- 어떤 주문 품목이 어떤 발주 품목에 포함되었는지 추적

CREATE TABLE IF NOT EXISTS po_order_links (
  id SERIAL PRIMARY KEY,
  purchase_order_item_id INTEGER NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_po_order_links_unique
  ON po_order_links(purchase_order_item_id, order_item_id);

-- RLS 비활성화 (service role만 접근)
ALTER TABLE po_order_links ENABLE ROW LEVEL SECURITY;
