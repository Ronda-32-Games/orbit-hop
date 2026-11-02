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

## Servidor (Daily)

`POST /api/start` da la semilla del día (secreta hasta ese día, igual para todos) y un token firmado. `POST /api/finish` recibe los toques, verifica initData de Telegram, el token, que no haya pasado menos tiempo real que el de la partida, y rehace la partida.

Falta con D1: token de un solo uso, 3 intentos del Daily (DEC-052) y ranking.

Para desplegar (Ignacio): `npx wrangler deploy` y los tres secretos que lista `wrangler.toml`. Después, en el repo, la variable `API_URL` con la dirección del Worker; sin ella el juego solo tiene Practice.

## Assets

Placeholder: formas en canvas en `src/client/render.ts`. Los de Lía reemplazan las funciones `draw*` (kit < 200 KB).
