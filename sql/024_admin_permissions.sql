-- 024: 계정별 메뉴 권한 설정
-- menu_permissions: NULL=전체접근, {sales:false, reports:false}=해당 메뉴 제한
-- is_master: 대표 계정 구분 (권한설정 권한자)

ALTER TABLE users ADD COLUMN IF NOT EXISTS menu_permissions JSONB DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_master BOOLEAN NOT NULL DEFAULT false;

-- 대표 계정 마스터 설정
UPDATE users SET is_master = true WHERE phone = '01085566774' AND role = 'admin';
