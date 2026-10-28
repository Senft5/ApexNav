-- Garage (docs/SOCIAL.md 2.4): a person's cars. Shown to accepted friends and crew-mates only when `shared` is on.
-- No location, no drive data: a car card is the car. Units are SI (kg, hp as the one exception car people use).
CREATE TABLE cars (
  id           TEXT PRIMARY KEY,
  owner        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year         INTEGER,
  make         TEXT NOT NULL,
  model        TEXT NOT NULL,
  trim         TEXT,
  nickname     TEXT,
  color        TEXT,
  power_hp     INTEGER,
  weight_kg    INTEGER,
  drivetrain   TEXT CHECK (drivetrain IN ('fwd','rwd','awd')),
  transmission TEXT CHECK (transmission IN ('manual','auto','dct')),
  tyres        TEXT,
  mods         TEXT,
  shared       INTEGER NOT NULL DEFAULT 0,
  is_primary   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX cars_owner ON cars(owner);
