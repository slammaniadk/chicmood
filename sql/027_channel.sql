-- 027_channel.sql
-- products 테이블에 channel 컬럼 추가
ALTER TABLE products ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'chicmood';
CREATE INDEX IF NOT EXISTS idx_products_channel ON products(channel);

-- broadcasts 테이블에 channel 컬럼 추가
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'chicmood';
CREATE INDEX IF NOT EXISTS idx_broadcasts_channel ON broadcasts(channel);
