-- Orbit Hop: jugadores, partidas, actividad y eventos (mismo molde que Sum 32, TASK-063).
-- Plazos (DEC-064): partidas 30 días; el resto 12 meses; todo se borra tras 12 meses sin entrar.
-- Los borra el cron diario del Worker (purge en src/server/worker.ts).

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,           -- id de Telegram
  name TEXT NOT NULL,               -- nombre + inicial del apellido, para el ranking
  lang TEXT,                        -- idioma de Telegram (en, es, ...), sin el @usuario
  created_at INTEGER NOT NULL,      -- ms
  last_seen INTEGER NOT NULL
);

-- Una fila por partida, Daily o Practice. Las de Practice también se rehacen en el servidor.
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  mode TEXT NOT NULL,               -- daily, practice
  day TEXT NOT NULL,                -- AAAA-MM-DD UTC
  seed INTEGER NOT NULL,
  rules TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  status TEXT NOT NULL,             -- open, done, rejected, abandoned
  reason TEXT,                      -- por qué se rechazó
  clean INTEGER NOT NULL DEFAULT 0, -- 1: el servidor rehizo la partida y dio igual
  score INTEGER NOT NULL DEFAULT 0,
  planet INTEGER NOT NULL DEFAULT 0,
  label TEXT,                       -- 20a / 20b
  taps INTEGER NOT NULL DEFAULT 0,
  captures INTEGER NOT NULL DEFAULT 0,
  perfects INTEGER NOT NULL DEFAULT 0,
  skips INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  miss_wall INTEGER NOT NULL DEFAULT 0,
  miss_ast INTEGER NOT NULL DEFAULT 0,
  powerups INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  bonus_s REAL NOT NULL DEFAULT 0,
  got32 INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0, -- reloj del juego, con el tiempo extra
  wall_ms INTEGER NOT NULL DEFAULT 0,     -- tiempo real de empezar a terminar
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_user_day ON runs (user_id, day, mode);
CREATE INDEX IF NOT EXISTS runs_day ON runs (day);

-- Mejor resultado del Daily por jugador y día: planeta, desempata puntaje, después el primero.
CREATE TABLE IF NOT EXISTS daily_best (
  day TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  planet INTEGER NOT NULL,
  score INTEGER NOT NULL,
  label TEXT,
  run_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (day, user_id)
);
CREATE INDEX IF NOT EXISTS daily_best_rank ON daily_best (day, planet DESC, score DESC, at);

-- Una fila por jugador y día activo (retención).
CREATE TABLE IF NOT EXISTS activity (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  source TEXT,                      -- de dónde entró el primer toque del día (start_param)
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;

-- Una fila por jugador, día y tipo de evento, con contador.
CREATE TABLE IF NOT EXISTS events (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 1,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'server', -- server o reported (lo avisó el juego)
  PRIMARY KEY (user_id, day, event)
) WITHOUT ROWID;
