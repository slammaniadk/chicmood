-- 023: 상품 카테고리 시스템
-- products 테이블에 category, length_options 컬럼 추가

ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS length_options TEXT DEFAULT '';
