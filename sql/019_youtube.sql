-- YouTube 라이브 채팅 연동용 컬럼
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS youtube_video_id TEXT;
