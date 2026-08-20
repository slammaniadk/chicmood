CREATE TABLE IF NOT EXISTS after_services (
  id SERIAL PRIMARY KEY,
  as_no TEXT NOT NULL UNIQUE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT DEFAULT '',
  product_name TEXT NOT NULL,
  color TEXT DEFAULT '',
  size TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT '수선' CHECK (type IN ('수선','교체','기타')),
  status TEXT NOT NULL DEFAULT '접수' CHECK (status IN ('접수','처리중','완료')),
  description TEXT,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS after_service_images (
  id SERIAL PRIMARY KEY,
  after_service_id INTEGER NOT NULL REFERENCES after_services(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_as_status ON after_services(status);
CREATE INDEX IF NOT EXISTS idx_as_images ON after_service_images(after_service_id);
