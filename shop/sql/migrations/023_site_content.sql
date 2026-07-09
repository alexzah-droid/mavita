BEGIN;

CREATE TABLE IF NOT EXISTS site_content (
    singleton BOOLEAN PRIMARY KEY DEFAULT true
      CONSTRAINT site_content_singleton_check CHECK (singleton),
    about_text TEXT NOT NULL
      CONSTRAINT site_content_about_text_length_check
      CHECK (char_length(btrim(about_text)) BETWEEN 1 AND 5000),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by_actor_login_at BIGINT NOT NULL
);

COMMIT;
