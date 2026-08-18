-- 상품에 사이즈 자유입력 컬럼 추가
ALTER TABLE products ADD COLUMN IF NOT EXISTS size TEXT DEFAULT '';
