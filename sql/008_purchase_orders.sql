-- 008_purchase_orders.sql: 발주서 테이블

-- 발주서
CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  po_no TEXT NOT NULL UNIQUE,       -- 발주번호 (PO-20260813-001)
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT '발주대기' CHECK (status IN ('발주대기', '발주완료', '입고중', '입고완료', '취소')),
  total_amount INTEGER DEFAULT 0,
  memo TEXT,
  ordered_at TIMESTAMPTZ,           -- 발주 확정일
  expected_at TIMESTAMPTZ,          -- 입고 예정일
  completed_at TIMESTAMPTZ,         -- 입고 완료일
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 발주 품목
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  color_name TEXT DEFAULT '',
  size_name TEXT DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1,
  cost_price INTEGER NOT NULL DEFAULT 0,
  subtotal INTEGER NOT NULL DEFAULT 0,
  received_qty INTEGER DEFAULT 0
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_id ON purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po_id ON purchase_order_items(purchase_order_id);

-- RLS
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
