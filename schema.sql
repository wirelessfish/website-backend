CREATE TABLE IF NOT EXISTS guestbook (
    id TEXT PRIMARY KEY,
    reply TEXT,
    date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1,
    website TEXT,
    FOREIGN KEY (reply) REFERENCES guestbook(id)
);