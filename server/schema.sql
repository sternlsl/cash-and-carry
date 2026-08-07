-- Applied automatically on boot by index.js; kept here for reference and for
-- anyone who would rather run migrations by hand.

CREATE TABLE IF NOT EXISTS scores (
  id         bigserial PRIMARY KEY,
  board      text        NOT NULL,
  name       text        NOT NULL,
  name_key   text        NOT NULL,
  ni         integer     NOT NULL,
  cash       integer     NOT NULL,
  stars      smallint    NOT NULL DEFAULT 0,
  bust       boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per player per board. name_key is the lowercased name, so "Dana" and
-- "dana" are the same student rather than two leaderboard entries.
CREATE UNIQUE INDEX IF NOT EXISTS scores_board_name_key
  ON scores (board, name_key);

-- Matches the leaderboard sort: solvent players first, then by net income.
CREATE INDEX IF NOT EXISTS scores_board_rank
  ON scores (board, bust, ni DESC);
