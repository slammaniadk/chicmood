-- ============================================================
--  CHICMOOD DB Schema
--  Supabase SQL Editor에서 실행
-- ============================================================

-- 1. users
CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL UNIQUE,
  password   TEXT NOT NULL,  -- 4자리 숫자 (해싱 없이 단순 비교)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. broadcasts
CREATE TABLE IF NOT EXISTS broadcasts (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  date_text    TEXT NOT NULL,           -- '2026.08.12 (화) 20:00'
  scheduled_at TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'upcoming'
                 CHECK (status IN ('live','ended','upcoming')),
  description  TEXT
);

-- 3. products
CREATE TABLE IF NOT EXISTS products (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  price          INTEGER NOT NULL,
  original_price INTEGER NOT NULL,
  discount       INTEGER NOT NULL DEFAULT 0,
  description    TEXT,
  material       TEXT
);

-- 4. product_images
CREATE TABLE IF NOT EXISTS product_images (
  id         SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url  TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 5. product_colors
CREATE TABLE IF NOT EXISTS product_colors (
  id         SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  hex_code   TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 6. broadcast_products (다대다)
CREATE TABLE IF NOT EXISTS broadcast_products (
  broadcast_id INTEGER NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (broadcast_id, product_id)
);

-- 7. orders
CREATE SEQUENCE IF NOT EXISTS order_seq START 1;

CREATE TABLE IF NOT EXISTS orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no     TEXT NOT NULL UNIQUE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,
  social       TEXT,
  address      TEXT NOT NULL,
  memo         TEXT,
  subtotal     INTEGER NOT NULL,
  shipping_fee INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT '입금대기'
                 CHECK (status IN ('입금대기','확인요청','결제완료','배송중')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. order_items
CREATE TABLE IF NOT EXISTS order_items (
  id         SERIAL PRIMARY KEY,
  order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  size       TEXT NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 1,
  price      INTEGER NOT NULL,
  subtotal   INTEGER NOT NULL
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_orders_phone_last4 ON orders (right(phone, 4));
CREATE INDEX IF NOT EXISTS idx_orders_order_no ON orders (order_no);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images (product_id);
CREATE INDEX IF NOT EXISTS idx_product_colors_product_id ON product_colors (product_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_products_broadcast_id ON broadcast_products (broadcast_id);
