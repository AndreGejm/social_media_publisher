CREATE VIRTUAL TABLE IF NOT EXISTS catalog_track_search
USING fts5(
  track_id UNINDEXED,
  title,
  artist_name,
  album_title,
  file_path,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS trg_catalog_track_search_ai
AFTER INSERT ON catalog_tracks
BEGIN
  INSERT INTO catalog_track_search(track_id, title, artist_name, album_title, file_path)
  SELECT
    NEW.track_id,
    NEW.title,
    a.name,
    COALESCE(al.title, ''),
    m.primary_file_path
  FROM catalog_artists a
  LEFT JOIN catalog_albums al ON al.album_id = NEW.album_id
  JOIN catalog_media_assets m ON m.media_asset_id = NEW.media_asset_id
  WHERE a.artist_id = NEW.artist_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_track_search_au
AFTER UPDATE OF title, artist_id, album_id, media_asset_id ON catalog_tracks
BEGIN
  DELETE FROM catalog_track_search WHERE track_id = OLD.track_id;
  INSERT INTO catalog_track_search(track_id, title, artist_name, album_title, file_path)
  SELECT
    NEW.track_id,
    NEW.title,
    a.name,
    COALESCE(al.title, ''),
    m.primary_file_path
  FROM catalog_artists a
  LEFT JOIN catalog_albums al ON al.album_id = NEW.album_id
  JOIN catalog_media_assets m ON m.media_asset_id = NEW.media_asset_id
  WHERE a.artist_id = NEW.artist_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_track_search_ad
AFTER DELETE ON catalog_tracks
BEGIN
  DELETE FROM catalog_track_search WHERE track_id = OLD.track_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_track_search_artist_au
AFTER UPDATE OF name ON catalog_artists
BEGIN
  DELETE FROM catalog_track_search
  WHERE track_id IN (
    SELECT track_id FROM catalog_tracks WHERE artist_id = NEW.artist_id
  );
  INSERT INTO catalog_track_search(track_id, title, artist_name, album_title, file_path)
  SELECT
    t.track_id,
    t.title,
    NEW.name,
    COALESCE(al.title, ''),
    m.primary_file_path
  FROM catalog_tracks t
  LEFT JOIN catalog_albums al ON al.album_id = t.album_id
  JOIN catalog_media_assets m ON m.media_asset_id = t.media_asset_id
  WHERE t.artist_id = NEW.artist_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_track_search_album_au
AFTER UPDATE OF title ON catalog_albums
BEGIN
  DELETE FROM catalog_track_search
  WHERE track_id IN (
    SELECT track_id FROM catalog_tracks WHERE album_id = NEW.album_id
  );
  INSERT INTO catalog_track_search(track_id, title, artist_name, album_title, file_path)
  SELECT
    t.track_id,
    t.title,
    a.name,
    NEW.title,
    m.primary_file_path
  FROM catalog_tracks t
  JOIN catalog_artists a ON a.artist_id = t.artist_id
  JOIN catalog_media_assets m ON m.media_asset_id = t.media_asset_id
  WHERE t.album_id = NEW.album_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_track_search_media_au
AFTER UPDATE OF primary_file_path ON catalog_media_assets
BEGIN
  DELETE FROM catalog_track_search
  WHERE track_id IN (
    SELECT track_id FROM catalog_tracks WHERE media_asset_id = NEW.media_asset_id
  );
  INSERT INTO catalog_track_search(track_id, title, artist_name, album_title, file_path)
  SELECT
    t.track_id,
    t.title,
    a.name,
    COALESCE(al.title, ''),
    NEW.primary_file_path
  FROM catalog_tracks t
  JOIN catalog_artists a ON a.artist_id = t.artist_id
  LEFT JOIN catalog_albums al ON al.album_id = t.album_id
  WHERE t.media_asset_id = NEW.media_asset_id;
END;

DELETE FROM catalog_track_search;
INSERT INTO catalog_track_search(track_id, title, artist_name, album_title, file_path)
SELECT
  t.track_id,
  t.title,
  a.name,
  COALESCE(al.title, ''),
  m.primary_file_path
FROM catalog_tracks t
JOIN catalog_artists a ON a.artist_id = t.artist_id
LEFT JOIN catalog_albums al ON al.album_id = t.album_id
JOIN catalog_media_assets m ON m.media_asset_id = t.media_asset_id;
