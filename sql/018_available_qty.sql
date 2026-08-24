-- 018_available_qty.sql: 상품별 판매가능수량 (NULL=무제한, 숫자=지정한 만큼만 판매 가능)
ALTER TABLE products ADD COLUMN IF NOT EXISTS available_qty INTEGER DEFAULT NULL;
