-- Applied automatically on boot by index.js; kept here for reference and for
-- anyone who would rather run migrations by hand.

CREATE TABLE IF NOT EXISTS scores (
  id         bigserial PRIMARY KEY,
  board      text        NOT NULL,
  google_sub text        NOT NULL,  -- Google's stable per-account id
  email      text        NOT NULL,  -- school address, for the instructor's reference
  name       text        NOT NULL,  -- display name shown on the board
  ni         integer     NOT NULL,
  cash       integer     NOT NULL,
  stars      smallint    NOT NULL DEFAULT 0,
  bust       boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Identity is the Google account, not the typed name: one row per student per
-- board regardless of what display name they enter.
CREATE UNIQUE INDEX IF NOT EXISTS scores_board_sub
  ON scores (board, google_sub);

-- Matches the leaderboard sort: solvent players first, then by net income.
CREATE INDEX IF NOT EXISTS scores_board_rank
  ON scores (board, bust, ni DESC);

-- Left over from the pre-authentication schema, which keyed on the typed name.
DROP INDEX IF EXISTS scores_board_name_key;
