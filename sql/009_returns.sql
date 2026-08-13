-- 009_returns.sql: 반품/교환/취소 테이블

-- 반품/교환/취소 접수
CREATE TABLE IF NOT EXISTS returns (
  id SERIAL PRIMARY KEY,
  return_no TEXT NOT NULL UNIQUE,    -- RET-20260813-001
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('반품', '교환', '취소')),
  status TEXT NOT NULL DEFAULT '접수' CHECK (status IN ('접수', '처리중', '회수중', '완료', '거부')),
  reason TEXT,
  refund_amount INTEGER DEFAULT 0,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 반품 품목
CREATE TABLE IF NOT EXISTS return_items (
  id SERIAL PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  order_item_id INTEGER REFERENCES order_items(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '',
  size TEXT DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1,
  price INTEGER NOT NULL DEFAULT 0
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_returns_order_id ON returns(order_id);
CREATE INDEX IF NOT EXISTS idx_returns_type ON returns(type);
CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);
CREATE INDEX IF NOT EXISTS idx_return_items_return_id ON return_items(return_id);

-- RLS
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;
