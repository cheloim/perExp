# Migraciones de esquema

> **Estado actual: Alembic es la única vía.** Las revisiones viven en
> `src/backend/alembic/versions/`, se aplican en el release (`deploy.yml`, job
> `migrate`) y se validan antes de mergear contra un fixture anonimizado de
> producción. `create_all` y `add_indices` ya no corren al arrancar.

## Cómo se aplica

1. El PR agrega una revisión de Alembic y pasa el gate `migration-fixture.yml`:
   se restaura el dump anonimizado del último release y se corre `alembic upgrade head`.
2. Al publicar un release, `deploy.yml` hace, en orden: backup verificable →
   `alembic upgrade head` con la imagen nueva → recién ahí recrea la app.
3. Si la migración falla, `deploy-platform` no arranca: producción se queda con
   la versión anterior y el backup queda disponible.
4. `.github/workflows/migrations.yml` queda como herramienta manual para
   inspeccionar o reaplicar con la imagen deployada.

## Reglas

1. **Toda migración es una revisión de Alembic.** No se editan tablas a mano en
   producción; si hace falta un hotfix, se escribe una revisión, aunque sea de una línea.
2. **No se agregan scripts `migrate_*.py`.** Los existentes quedan archivados; el
   esquema real ya está en el baseline y en las revisiones 2/3.
3. **Toda revisión es idempotente** (`IF NOT EXISTS` / chequeo previo). El baseline
   crea el esquema desde los modelos actuales con `checkfirst=True`, así que una base
   nueva ya puede traer una columna que una revisión posterior intentaría agregar.
4. **Toda migración es reversible o declara por qué no lo es.**
5. **Cambios destructivos: expand / contract**, nunca en un solo release.

## Baseline

`000000000001_baseline.py` llama a `Base.metadata.create_all(checkfirst=True)`. En una
base existente no crea nada que ya esté; en una vacía crea el esquema completo. Las
revisiones 2/3 usan `ADD COLUMN IF NOT EXISTS`, así que aplicarlas sobre una base recién
creada es un no-op. `alembic check` en CI verifica que el esquema migrado coincida con
los modelos.

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

## Estado del camino de salida (#527)

- [x] Baseline real que crea el esquema desde los modelos (idempotente).
- [x] `create_all` y `add_indices` fuera del arranque de la app.
- [x] `deploy.yml` corre `alembic upgrade head` en el release, después del backup.
- [x] `migrations.yml` es una herramienta manual sobre la imagen deployada.
- [x] Test de Alembic (base limpia → `upgrade head` → `alembic check`) en la suite.
- [x] Fixture anonimizado como gate de cada PR que toca `alembic/**`.

Pendiente: los `migrate_*.py` viejos quedan en el repo como archivos archivados
hasta que se limpien en un PR aparte.
