-- Tutorial fantasma de la primera partida (TASK-067 / DEC-058, molde de Sum 32):
-- 1 cuando la persona lo vio entero o lo cortó. No vuelve a salir.
ALTER TABLE users ADD COLUMN tutorial_done INTEGER NOT NULL DEFAULT 0;
