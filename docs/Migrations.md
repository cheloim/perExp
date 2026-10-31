# Migraciones de esquema

> **Estado actual: no hay una estrategia única.** Conviven tres mecanismos. Este documento
> describe la realidad, el riesgo y el camino de salida. La implementación está trackeada
> en [#527](https://github.com/cheloim/perExp/issues/527).

## Los tres mecanismos que existen hoy

| Mecanismo | Dónde | Qué hace | Problema |
|---|---|---|---|
| `Base.metadata.create_all()` | `src/backend/main.py:68` (lifespan) | Crea tablas que falten al arrancar | No migra columnas existentes, no versiona, ejecuta DDL en cada boot |
| `add_indices.py` | `src/backend/app/add_indices.py` | Crea índices al arrancar | DDL implícito, sin control de orden |
| Alembic | `src/backend/alembic/versions/` (2 revisiones) | Versionado formal | No se ejecuta en el entrypoint; el baseline es no-op |
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
   uno y se archivan.
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
- [ ] `docs/Data-Model.md` actualizado si cambia una relación.
- [ ] El deploy no depende de `create_all`.

## Camino de salida

1. Generar una revisión baseline desde el esquema real de producción.
2. Sacar `create_all` y `add_indices` del lifespan cuando el baseline esté aplicado.
3. Convertir cada `migrate_*.py` pendiente en una revisión de Alembic.
4. Hacer que `migrations.yml` ejecute `alembic upgrade head`, no scripts sueltos.
5. Agregar `alembic check` al CI.
