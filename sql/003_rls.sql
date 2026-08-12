-- ============================================================
--  CHICMOOD Row Level Security (RLS) Policies
-- ============================================================

-- 카탈로그 테이블: 공개 읽기
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "broadcasts_public_read" ON broadcasts
  FOR SELECT USING (true);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_public_read" ON products
  FOR SELECT USING (true);

ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_images_public_read" ON product_images
  FOR SELECT USING (true);

ALTER TABLE product_colors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_colors_public_read" ON product_colors
  FOR SELECT USING (true);

ALTER TABLE broadcast_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "broadcast_products_public_read" ON broadcast_products
  FOR SELECT USING (true);

-- 회원/주문 테이블: service_role만 접근 (API 서버에서 service_role 키 사용)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- anon 접근 불가 → 모든 CRUD는 service_role 키로

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- anon 접근 불가

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
-- anon 접근 불가
