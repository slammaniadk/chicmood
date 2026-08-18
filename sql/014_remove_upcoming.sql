-- 014_remove_upcoming.sql: 방송 상태에서 'upcoming(예정)' 제거

-- 1) 기존 upcoming 방송을 live로 변경
UPDATE broadcasts SET status = 'live' WHERE status = 'upcoming';

-- 2) 기존 CHECK 제약조건 삭제 후 새로 생성
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_status_check;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_status_check CHECK (status IN ('live', 'ended'));

-- 3) 기본값 변경
ALTER TABLE broadcasts ALTER COLUMN status SET DEFAULT 'live';
