-- 025_warehouse.sql: 보관창고 기능 추가 (재고관리)

-- inventory 테이블에 warehouse 컬럼 추가 (기본값 '판매')
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS warehouse TEXT NOT NULL DEFAULT '판매';

-- 기존 UNIQUE 제약조건 제거 후 warehouse 포함 새 제약조건 추가
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_product_id_color_name_size_name_key;
ALTER TABLE inventory ADD CONSTRAINT inventory_product_id_color_name_size_name_warehouse_key
  UNIQUE(product_id, color_name, size_name, warehouse);

-- inventory_log에 warehouse 컬럼 추가
ALTER TABLE inventory_log ADD COLUMN IF NOT EXISTS warehouse TEXT;

-- inventory_log의 type CHECK 제약조건 변경 (transfer 허용)
ALTER TABLE inventory_log DROP CONSTRAINT IF EXISTS inventory_log_type_check;
ALTER TABLE inventory_log ADD CONSTRAINT inventory_log_type_check
  CHECK (type IN ('in', 'out', 'adjust', 'return', 'sale', 'transfer'));
