# Database

The `blog` table will be implemented at a later date.

There should be 4 weekly and 3 monthly backups kept.

## Table `guestbook`

Replies cannot be nested, only the "top level" comments can be replied to. Replies should be displayed in order of oldest to newest in the interface.

`id` = UUID v4 string

```SQL
CREATE TABLE guestbook (
    id TEXT PRIMARY KEY,
    reply TEXT,
    date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1,
    website TEXT
);
```

## Idea: `blog` table

```sql
CREATE TABLE blog (
    id TEXT PRIMARY KEY (UUID),
    likes INTEGER DEFAULT 0 NOT NULL,
    ...
);
```

Possibly another table like `blog_comments` that would contain comments to spesific blogposts with a foreign key referencing a certain blogpost?
