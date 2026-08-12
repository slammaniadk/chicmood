-- ============================================================
--  CHICMOOD Supabase Storage
--  product-images 버킷 생성 (공개 읽기)
-- ============================================================

-- 버킷 생성
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- 공개 읽기 정책
CREATE POLICY "product_images_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'product-images');

-- service_role만 업로드 가능 (API 서버에서 서명 URL 발급)
CREATE POLICY "product_images_service_upload" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'product-images' AND auth.role() = 'service_role');
