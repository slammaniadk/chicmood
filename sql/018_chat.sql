CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  sender_id UUID NOT NULL REFERENCES users(id),
  sender_name TEXT NOT NULL,
  message TEXT,
  image_url TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at);
