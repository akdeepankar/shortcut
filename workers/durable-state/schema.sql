CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    video_url TEXT,
    user_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT,
    transcript_key TEXT,
    visual_key TEXT
);
