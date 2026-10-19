# AGENTS.md — agentes en paralelo

Protocolo de coordinación cuando un trabajo se divide entre varios agentes. Aplica a
cualquier sesión o agente de este repo. El objetivo es bajar el tiempo de pared sin que
dos agentes se pisen: **no paralelizar por costumbre, paralelizar cuando hay solapamiento
cero o cuando el conflicto se puede resolver una sola vez arriba.**

Las convenciones del proyecto, los comandos y las reglas de código están en `CLAUDE.md`.
Este archivo es sólo sobre cómo coordinar trabajo concurrente.

---

## 1. Clasificar por archivos, no por "tarea"

Antes de lanzar nada, armar el **DAG** con los conjuntos de archivos que toca cada unidad
de trabajo. La clasificación decide todo lo demás:

| Relación | Estrategia |
|---|---|
| **Disjuntos** | Agentes en paralelo, sin más. |
| **Solapados** | En paralelo, cada uno en su rama virtual. La fusión se resuelve **una sola vez** en la rama de integración (punto 4). Nunca que un agente reescriba el trabajo de otro. |
| **Dependientes** (el resultado de uno es entrada del otro) | Consecutivos, en orden. Ejemplo real: un gate de CI no puede entrar antes de que pase la corrección que lo habilita, o `main` queda rojo. |

Un DAG típico mezcla las tres: dos ramas disjuntas que entre sí tienen un orden de merge.

## 2. Un agente = un worktree + una rama

Nunca comparten working tree.

- Worktree fuera del repo: `/tmp/opencode/wt-<nombre>`.
- Rama desde `origin/main`, o desde la rama de integración si el trabajo depende de otro.
- Crear los worktrees desde el coordinador, con el symlink de `node_modules` si el agente
  va a tocar frontend:
  `ln -s $REPO/src/frontend/node_modules $WT/src/frontend/node_modules`
- El agente escribe **sólo** en su worktree. `/home/chelo/creditCardAnalyzer` es el
  worktree del coordinador y no se toca.

## 3. Estado global compartido: declararlo en el brief

Los archivos no son lo único que compiten. Lo que sigue es único en la máquina y hay que
nombrarlo explícitamente en cada brief, con la regla de quién puede usarlo:

| Recurso | Regla |
|---|---|
| **Postgres de tests** | Un solo agente puede correr `pytest` a la vez. Se corre **una vez, al final** del trabajo, no por cada iteración. |
| **`node_modules`** | Compartido por symlink. Nadie lo reinstala ni lo borra. |
| **Containers / `smoke.sh`** | No se ejecuta mientras haya otros agentes corriendo: reinicia servicios que otros usan. |
| **Secretos, `.env`, `deploy.yml`, branch protection** | Sólo el coordinador. |
| **Issues / PRs en GitHub** | Sólo el coordinador salvo que el brief lo asigne explícitamente. |

## 4. Rama de integración

Cuando hay solapamiento **o** dependencia de orden, los trabajos no van directo a `main`:

1. `integration/<lote>` desde `origin/main`.
2. Mergear cada rama en orden del DAG, `--no-ff`, a la rama de integración.
3. Los conflictos se resuelven **una sola vez**, en el punto de integración.
4. Verificación completa **una vez** sobre el estado combinado (punto 5).
5. **Un solo PR** a `main`.

Si un agente abrió su PR contra `main`, se retargetea:
`gh pr edit <n> --base integration/<lote>`.

Con trabajo disjunto y sin dependencia de orden, dos PRs directos a `main` están bien. La
rama de integración es para el caso con conflicto, no por default.

## 5. Verificación: el slice de cada uno, completa una vez arriba

- **Cada agente** verifica su slice: los tests del área, el linter de los archivos que
  tocó. Nada más.
- **En la integración** se corre la verificación completa una sola vez
  (`./scripts/verify.sh`).
- No repetir un comando que ya pasó si nada cambió desde entonces: no agrega información.

## 6. Brief mínimo

Cada agente recibe un brief autocontenido — arranca con contexto limpio y no ve esta
conversación. Tiene que decir, como mínimo:

```
TRABAJO: <qué se hace, en una oración>
WORKTREE: /tmp/opencode/wt-<nombre> (rama <rama>, ya creada desde <base>)
ARCHIVOS PERMITIDOS: <lista explícita>
ARCHIVOS PROHIBIDOS: <todo lo demás; nombrar los que dan tentación>
ESTADO COMPARTIDO: <qué recursos globales usa y cuáles no>
TAREA: <pasos, con archivo:línea donde se pueda>
VERIFICACIÓN: <comandos exactos, con el resultado esperado>
COMMIT: uno solo, Conventional Commits, body que explica el porqué.
       Firmar con: Co-Authored-By: OpenCode <noreply@opencode.ai>
PUSH + PR: <rama>, PR contra <base>, con el resultado de verificación observado
REGLAS: no crear archivos de plan, no ampliar alcance, no tocar <lo sensible>
REPORTE: URL del PR, verificación observada, decisiones tomadas, qué dejó afuera
```

Decirle al agente qué **no** hacer funciona mejor que esperar que lo adivine. Un agente
al que no se le prohíbe `pytest` lo va a correr, y le va a romper la corrida al otro.

## 7. Roles

**Coordinador** (la sesión que lanza):
arma el DAG, crea los worktrees y los briefs, espera (no sondea) los resultados, mergea
en orden, corre la verificación final, maneja branch protection y las mutaciones externas
(issues, PRs, config de GitHub).

**Agente**: su slice, nada más. Reporta lo observado, no lo supuesto: la verificación que
corrió y su salida real, no "debería pasar".

## 8. Lanzar y esperar

- Agentes independientes: en background, todos juntos, en un solo paso.
- **No sondear** ni pedirles estado. Se espera la notificación de fin y se sigue con otra
  cosa que no pise sus archivos.
- Mientras corren, el coordinador trabaja en lo disjunto: issues, branch protection,
  configuración externa.

## 9. Anti-patrones

- Dos agentes en el mismo worktree.
- Un agente corriendo la verificación completa "por las dudas": consume los recursos
  compartidos y no agrega nada sobre la corrida de integración.
- Merge directo a `main` cuando hay dependencia de orden.
- Resolver conflictos dentro de un agente sobre trabajo ajeno.
- Ampliar alcance fuera del brief.
- Correr `smoke.sh` o suites pesadas con otros agentes en curso.
- Sondear agentes en vez de esperar la notificación.

---

## Historial de uso

| Lote | Trabajo | Ramas | Resultado |
|---|---|---|---|
| `ci-hardening` | 17 errores de `mypy` + gates de CI y pipeline de tests | `fix/backend-types`, `chore/ci-gates` → `integration/ci-hardening` | en curso |
