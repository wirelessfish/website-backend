BEGIN;

-- guestbook counter (old table: messages)
UPDATE sqlite_sequence
SET seq = MAX(seq, COALESCE((SELECT seq FROM old.sqlite_sequence WHERE name = 'messages'), 0))
WHERE name = 'guestbook';

INSERT INTO sqlite_sequence (name, seq)
SELECT 'guestbook', seq FROM old.sqlite_sequence
WHERE name = 'messages'
  AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'guestbook');

INSERT INTO guestbook (id, date, name, content, site, reply, status, badge)
SELECT
  m.id,
  m.created,
  m.name,
  m.content,
  m.site,
  CASE WHEN EXISTS (SELECT 1 FROM old.messages p WHERE p.id = m.reply_to)
       THEN m.reply_to END,
  CASE m.visible WHEN 1 THEN 'visible' ELSE 'hidden' END,
  CASE m.verified WHEN 1 THEN 'owner' END
FROM old.messages m
ORDER BY m.id;

-- ntfy counter
UPDATE sqlite_sequence
SET seq = MAX(seq, COALESCE((SELECT seq FROM old.sqlite_sequence WHERE name = 'ntfy'), 0))
WHERE name = 'ntfy';

INSERT INTO sqlite_sequence (name, seq)
SELECT 'ntfy', seq FROM old.sqlite_sequence
WHERE name = 'ntfy'
  AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'ntfy');

INSERT INTO ntfy (id, date, content)
SELECT id, date, text FROM old.ntfy ORDER BY id;

COMMIT;