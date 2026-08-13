-- 006_vendors.sql: 거래처 테이블 + products 컬럼 추가

-- 거래처 테이블
CREATE TABLE IF NOT EXISTS vendors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT,          -- 담당자명
  phone TEXT,
  email TEXT,
  address TEXT,
  bank_info TEXT,        -- 입금계좌 정보
  memo TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- products에 거래처/매입가 컬럼 추가
ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price INTEGER DEFAULT 0;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_vendors_is_active ON vendors(is_active);
CREATE INDEX IF NOT EXISTS idx_products_vendor_id ON products(vendor_id);

-- RLS
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
-- service_role만 접근 (admin API가 service_role 키 사용)
