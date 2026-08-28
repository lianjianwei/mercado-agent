-- Local publish state is a marker the app owns: it records that THIS app called
-- the Miaoshou publish endpoint for a product, without trusting the remote
-- lifecycle yet. The remote state (state column) is decided only by what the
-- collect-box list API reports. local_published_at records when the local
-- publish was submitted so later phases can apply the 2-hour publish rule.
ALTER TABLE products ADD COLUMN local_publish_state TEXT NOT NULL DEFAULT 'notPublished' CHECK (local_publish_state IN ('notPublished', 'localPublished', 'localFailed'));
ALTER TABLE products ADD COLUMN local_published_at TEXT;
