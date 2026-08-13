-- 010_system.sql: 관리자 로그, 시스템 설정 테이블

-- 관리자 활동 로그
CREATE TABLE IF NOT EXISTS admin_logs (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT,
  action TEXT NOT NULL,           -- 'create', 'update', 'delete', 'login', 'export' 등
  target_type TEXT,               -- 'order', 'product', 'vendor', 'broadcast' 등
  target_id TEXT,
  detail JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 시스템 설정
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 기본 설정 삽입
INSERT INTO system_settings (key, value) VALUES
  ('shipping', '{"carrier": "로젠택배", "fee": 2800, "freeThreshold": 50000, "code": "010"}'::jsonb),
  ('bank', '{"bankName": "", "accountNo": "", "holder": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_admin_logs_user_id ON admin_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at);

-- RLS
ALTER TABLE admin_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
