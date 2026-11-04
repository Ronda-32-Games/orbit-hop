# Orbit Hop

Segundo juego de Ronda 32. TypeScript web, canvas, sin motor. Mini App de Telegram que sale de @ronda32games_bot.

- Juego: `https://ronda-32-games.github.io/orbit-hop/` (cuando se publique)
- Reglas: GDD v0.2 (cierre del prototipo, 01/11/2026). Parámetros en `src/rules/config.json`.

## Cómo está armado

```
src/rules/    reglas compartidas: las corre el teléfono y las rehace el servidor
src/client/   juego en el navegador (canvas, HUD, Telegram, modo de prueba)
src/server/   servidor en Cloudflare Workers: semilla del Daily y validador
test/         pruebas (node:test)
tools/        build, bot de pruebas y partidas de referencia
```

**La regla de oro:** una partida es `(semilla, ticks de los toques)`. El juego corre a pasos fijos de 1/60 s; cada toque se anota con el número de tick. El servidor rehace la partida con el mismo `src/rules` y solo acepta el puntaje si da igual.

Para que dé igual en Android (V8), iPhone (JavaScriptCore) y el servidor (V8), `src/rules` no usa `Math.sin`, `Math.cos`, `Math.atan2` ni nada que cambie entre motores: usa `src/rules/dmath.ts`. Una prueba lo revisa.

## Comandos

```
npm install
npm test            # reglas, validador, trampas y servidor
npm run typecheck
npm run dev         # http://localhost:8032
npm run build       # dist/ para GitHub Pages
npm run golden      # regenerar partidas de referencia (solo si cambian las reglas)
```

## Modo de prueba (mismo criterio que Sum 32, DEC-038)

| En la dirección | Desde Telegram | Qué hace |
| --- | --- | --- |
| `?test` | `startapp=test` | panel ms (fps, tick, toques, huella) |
| `?seed=32` | `startapp=test_seed32` | grilla fija, sin récord |
| `?round=5` | `startapp=test_round5` | partida de 5 s, sin récord |
| `?selftest` | `startapp=selftest` | rehace 6 partidas de referencia en el motor del teléfono y dice PASS o FAIL |

El `selftest` es la prueba que importa en iPhone: si da FAIL, las reglas no son deterministas en ese motor y el Daily no se puede validar ahí.

## Servidor (Daily y tracking)

Cloudflare Worker + D1 (`src/server`, `migrations/`). Todo pedido del juego lleva el initData de Telegram.

| Ruta | Qué hace |
| --- | --- |
| `GET /api/health` | ¿está vivo? |
| `POST /api/session` | al abrir: guarda al jugador, cuenta el día activo (con el `start_param` del link) y devuelve los intentos del Daily |
| `POST /api/start` | gasta un intento del Daily (3 por día, DEC-052) y da semilla + token |
| `POST /api/finish` | rehace la partida, la cierra (token de un solo uso) y guarda el mejor del día |
| `POST /api/practice` | cada Practice terminada: el servidor la rehace y la guarda (marca `clean`) |
| `POST /api/event` | lo que avisa el juego cada 60 s: segundos visibles, Practice empezadas, pausas |
| `POST /api/me/delete` | borra todo lo de quien pide (botón "Delete my data" del menú) |
| `GET /api/stats/<informe>.csv\|.json` | informes sin nombres, con `Authorization: Bearer STATS_TOKEN` |

Informes: `overview`, `retention` (día 1 y 7), `funnel`, `planets` (hasta dónde llegan), `design` (perfectos, saltos, fallos por pared y asteroide, power-ups, racha, llegada al 32), `sources` (de qué link entran), `runs`, `players`. Tablero: `stats.html` en Pages (pide el STATS_TOKEN una vez). Privacidad: `privacy.html`.

El tracking corre solo dentro de Telegram y fuera del modo de prueba. Plazos (DEC-064): partidas 30 días, el resto 12 meses, todo tras 12 meses sin entrar; lo borra el cron diario del Worker.

### Publicación

Un push a `main` prueba todo y publica el juego en Pages. Si el repo tiene el secreto `CLOUDFLARE_API_TOKEN`, también publica el Worker: busca o crea la base D1 `orbit-hop`, aplica las migraciones, despliega y carga los secretos. `TOKEN_SECRET` y `DAILY_SECRET` los genera solo la primera vez; `BOT_TOKEN` (el de @ronda32games_bot) y `STATS_TOKEN` salen de los secretos del repo.

## Assets

Placeholder: formas en canvas en `src/client/render.ts`. Los de Lía reemplazan las funciones `draw*` (kit < 200 KB).
