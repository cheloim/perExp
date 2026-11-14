# Migraciones de esquema

> **Estado actual: no hay una estrategia única.** Conviven tres mecanismos. Este documento
> describe la realidad, el riesgo y el camino de salida. La implementación está trackeada
> en [#527](https://github.com/cheloim/perExp/issues/527).

## Los tres mecanismos que existen hoy

| Mecanismo | Dónde | Qué hace | Problema |
|---|---|---|---|
| `Base.metadata.create_all()` | `src/backend/main.py:68` (lifespan) | Crea tablas que falten al arrancar | No migra columnas existentes, no versiona, ejecuta DDL en cada boot |
| `add_indices.py` | `src/backend/app/add_indices.py` | Crea índices al arrancar | DDL implícito, sin control de orden |
| Alembic | `src/backend/alembic/versions/` (3 revisiones) | Versionado formal | No se ejecuta en el entrypoint; el baseline es no-op |
| Scripts `migrate_*.py` | `src/backend/scripts/`, ejecutados por `.github/workflows/migrations.yml` | Migraciones puntuales con tabla `schema_migrations` | Fuera de Alembic, sin rollback, orden por nombre |

## Consecuencia

- Un entorno nuevo y uno viejo pueden terminar con esquemas **distintos**.
- Cambiar una columna que ya existe no se puede: `create_all` no altera.
- No hay rollback: si una migración falla a mitad, queda a mano.
- El DDL de arranque bloquea tablas y alarga el boot.

## Regla transitoria (mientras dure la migración)

1. **Producción no usa `create_all`.** Cualquier cambio de esquema entra por
   `alembic revision --autogenerate` + revisión manual.
2. **No se editan tablas a mano en producción.** Si hace falta un hotfix, se escribe una
   revisión de Alembic, aunque sea de una línea.
3. **Los scripts `migrate_*.py` no se agregan.** Los existentes se migran a Alembic de a
   uno y se archivan. Excepción transitoria: mientras `migrations.yml` no ejecute Alembic,
   un cambio de esquema puede incluir un script `migrate_*.py` **idempotente** gemelo de
   la revisión, para que el workflow actual lo aplique al mergear.
4. **Toda migración es reversible o declara por qué no lo es.**

## Anatomía de una migración

```python
"""add description_norm to expenses

Revision ID: 000000000003
Revises: 000000000002
"""

def upgrade() -> None:
    op.add_column("expenses", sa.Column("description_norm", sa.Text(), nullable=True))
    op.create_index("ix_expenses_description_norm", "expenses", ["description_norm"])

def downgrade() -> None:
    op.drop_index("ix_expenses_description_norm", table_name="expenses")
    op.drop_column("expenses", "description_norm")
```

## Patrón expand / contract

Para cambios destructivos (renombrar o borrar columnas) en una app con deploy sin downtime:

1. **Expand:** agregar la columna nueva nullable, escribir en ambas, backfill en background.
2. **Migrate:** leer de la nueva, verificar que no quedan filas viejas.
3. **Contract:** en un deploy posterior, borrar la vieja.

Nunca en un solo paso:

```sql
-- ❌ rompe el deploy anterior que sigue escribiendo en la columna vieja
ALTER TABLE expenses RENAME COLUMN card_last4 TO card_id;
```

## Fixture anonimizado (gate de migraciones)

Toda revisión de Alembic se prueba antes de mergear sobre un **dump anonimizado
de producción**: datos reales en forma (nulabilidad, cardinalidad, claves
foráneas, tipos) y sintéticos en contenido. Una migración que funciona sobre una
base vacía puede romper con datos reales; esto lo agarra antes del deploy.

### Cómo se genera

En el server, a partir del último backup:

```bash
# Genera /opt/creditcardanalyzer/backups/db_anonymized.dump (+ .sha256)
/opt/creditcardanalyzer/anonymize/anonymize-db.sh
```

El script restaura el backup en una base scratch (`expenses_anon`), corre
`src/backend/scripts/anonymize_db.py`, verifica y deja el dump. La base de
producción no se toca. Se regenera después de cada release, para que represente
el esquema que está en producción.

### Cómo funciona

No descifra: reemplaza cada columna cifrada por el ciphertext de un valor
sintético, cifrado con una **key de anonimización pública** (sólo protege datos
sintéticos). La key de producción nunca se usa. Los `*_hmac` se recalculan con
la misma función que la app (`app/services/encryption.py`), agrupando por la
columna de lookup para preservar la semántica de dedup.

La cobertura es **fail-closed**: el script enumera las columnas reales y aborta
si alguna no está declarada en `src/backend/scripts/anonymization_registry.py`.
Agregar una columna sin clasificarla rompe la generación en vez de filtrar
datos.

| Qué | Acción |
|-----|--------|
| Dominio (`users`, `expenses`, `tags`, `cards`, `budgets`, ...) | Sintético por campo PII; ids, montos, fechas y FKs se conservan |
| Sumideros de PII (`import_jobs`, `monthly_reports`, `notifications`, `audit_logs`, `platform_logs`, `refresh_tokens`, `settings`, `analysis_history`, `impersonation_*`) | Se vacían |
| `categories` con `user_id IS NULL` | Se conservan: son del sistema, no del usuario |

Verificación antes de publicar el dump: todas las columnas cifradas descifran
con la key de anonimización, los `*_hmac` coinciden con su columna origen, no
quedan emails/teléfonos en columnas preservadas, los conteos por tabla no
cambian y no hay FKs rotas.

### Uso en CI

`.github/workflows/migration-fixture.yml` baja el dump y su checksum por SSH,
lo restaura y corre `alembic upgrade head` cuando un PR toca `alembic/**`.
Requiere que el fixture exista en el server; si falta, el job falla con un
mensaje explícito.

Mientras no exista el baseline (#527), el fixture no tiene `alembic_version` y
la cadena completa corre desde cero: cada revisión tiene que ser idempotente.
Cuando el baseline esté aplicado, el fixture arranca en la revisión de
producción y sólo corren las nuevas.

## Verificación antes de mergear

```bash
cd src/backend

# ¿la migración se puede aplicar desde cero?
alembic upgrade head

# ¿se puede revertir?
alembic downgrade -1
alembic upgrade head

# ¿el modelo y el esquema coinciden?
alembic check
```

## Checklist de PR con migración

- [ ] La revisión tiene `down_revision` correcto y no hay ramas.
- [ ] `downgrade()` funciona, o el PR explica por qué no aplica.
- [ ] El backfill es idempotente y no bloquea la tabla.
- [ ] Está probada en una base con datos representativos, no solo vacía.
- [ ] Pasa `alembic upgrade head` sobre el fixture anonimizado (`migration-fixture.yml`).
- [ ] `docs/Data-Model.md` actualizado si cambia una relación.
- [ ] El deploy no depende de `create_all`.

## Camino de salida

1. Generar una revisión baseline desde el esquema real de producción.
2. Sacar `create_all` y `add_indices` del lifespan cuando el baseline esté aplicado.
3. Convertir cada `migrate_*.py` pendiente en una revisión de Alembic.
4. Hacer que `migrations.yml` ejecute `alembic upgrade head`, no scripts sueltos.
5. Agregar `alembic check` al CI.
