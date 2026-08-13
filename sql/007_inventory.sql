-- 007_inventory.sql: 재고/입출고 이력 테이블

-- 재고 테이블
CREATE TABLE IF NOT EXISTS inventory (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color_name TEXT NOT NULL DEFAULT '',
  size_name TEXT NOT NULL DEFAULT '',
  stock_qty INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(product_id, color_name, size_name)
);

-- 입출고 이력
CREATE TABLE IF NOT EXISTS inventory_log (
  id SERIAL PRIMARY KEY,
  inventory_id INTEGER REFERENCES inventory(id) ON DELETE SET NULL,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('in', 'out', 'adjust', 'return')),
  qty INTEGER NOT NULL,
  reason TEXT,
  ref_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  ref_vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_inventory_product_id ON inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_log_product_id ON inventory_log(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_log_type ON inventory_log(type);
CREATE INDEX IF NOT EXISTS idx_inventory_log_created_at ON inventory_log(created_at);

-- RLS
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_log ENABLE ROW LEVEL SECURITY;
