# Seguridad

> Reescrito el 2026-10-30 contra el código. La versión anterior afirmaba una columna
> `description_search` que nunca existió, un script `migrate_encrypt_fields.py` inexistente,
> "sin cookies" cuando sí se usan, y recomendaba rotar una clave que otro documento declara
> no rotable.

## Modelo de seguridad en una página

| Activo | Protección |
|---|---|
| Documentos y transacciones | Aislamiento por `user_id` y grupos con membresía `accepted`. **No hay RLS en base.** |
| Campos con PII | Cifrado a nivel de aplicación con Fernet (`EncryptedType`) |
| Búsqueda sobre campos cifrados | HMAC-SHA256 determinístico (`*_hmac`) |
| Credenciales | bcrypt |
| Sesión | JWT HS256 + cookie HTTP-only |
| Segundo factor | TOTP opcional |
| Transporte | TLS terminado en nginx |
| Secretos | Podman secrets, montados como archivos |

**No hay cifrado en reposo del volumen completo ni RLS.** Si alguien accede a Postgres, ve
todo lo que no esté cifrado a nivel de columna.

## Cifrado de campos

`EncryptedType` (`app/types/encrypted.py`) envuelve `String` y cifra/descifra de forma
transparente con Fernet.

- Clave: `ENCRYPTION_KEY` si está definida; si no, `SHA256(SECRET_KEY)`.
- Si el descifrado falla, el valor se reemplaza por `[encrypted]` (no rompe la lectura).
- **Cambiar la clave deja ilegibles los datos existentes.** Ver `Key-Management.md`.

### Columnas cifradas

| Modelo | Campos |
|---|---|
| `User` | `full_name`, `telegram_chat_id`, `telegram_key`, `whatsapp_phone`, `google_refresh_token` |
| `Account` | `name`, `institution` |
| `Card` | `card_name`, `brand` |
| `Expense` | `description` |
| `Tag` | `name` |
| `ScheduledExpense` | `description` |
| `Investment` | `name` |
| `ImportJob` | `raw_text` |
| `MonthlyReport` | payload del reporte |

### Búsqueda sobre datos cifrados

No existe una columna tokenizada. Para buscar por descripción se usa
`description_hmac = compute_hmac(description)` (igualdad exacta) y, para búsqueda parcial,
el filtro descifra en aplicación (`services/expense_filters.py`). Ese enfoque es correcto
para privacidad y **caro** para volúmenes grandes: está trackeado en
[#523](https://github.com/cheloim/perExp/issues/523).

## Sesión y cookies

- JWT en `Authorization: Bearer` **y** cookie `oikonomia_auth`.
- Cookie: `httpOnly=true`, `secure=true`, `sameSite=lax`, `path=/`.
- Se usa para el flujo OAuth de Grafana, que necesita una cookie en el mismo dominio.
- Logout borra la cookie pero **no revoca el JWT** (ver `Authentication.md`).

## Aislamiento multi-tenant

- Cada consulta debería filtrar por el usuario o por los integrantes aceptados de su grupo.
- Hay 136 chequeos inline y tres copias divergentes de `get_group_user_ids`.
- La deduplicación de importaciones **no filtraba por usuario**; registrado en
  `GHSA-gwvx-c53m-33h4` y trackeado en [#524](https://github.com/cheloim/perExp/issues/524).

## Vulnerabilidades conocidas

Están en **Security Advisories privados** del repositorio porque el código es público. No
se replica el detalle acá hasta que estén corregidas.

| ID | Tema | Severidad |
|---|---|---|
| `GHSA-x54h-5rqj-mh63` | Bypass de MFA | Crítica |
| `GHSA-p86h-c2xv-j859` | Administrador sembrado con credenciales por defecto | Crítica |
| `GHSA-gwvx-c53m-33h4` | Fuga entre tenants en deduplicación | Alta |
| `GHSA-3p3m-cw22-v8wp` | Agotamiento del pool vía SSE | Alta |
| `GHSA-9mpx-qm3j-6836` | Credencial de base commiteada | Alta |

Seguimiento: <https://github.com/cheloim/perExp/security/advisories>

## Controles existentes

| Control | Estado |
|---|---|
| Validación de entrada | Pydantic en todos los routers |
| Rate limit | Login, registro y reset. Redis, ventana deslizante. |
| Lockout | Contador de fallos por email/IP |
| Auditoría | `audit_logs` para login, MFA y acciones admin |
| Borrado de cuenta | `services/account_deletion.py` |
| CORS | Lista explícita de orígenes |
| Secretos en logs | **Parcial.** Hay PII en logs y en `platform_logs` ([#526](https://github.com/cheloim/perExp/issues/526)). |
| Escaneo de dependencias | Dependabot, sin gate de CVEs |

## Lo que falta

| Hueco | Issue |
|---|---|
| Threat model formal y mapa de datos personales | [#533](https://github.com/cheloim/perExp/issues/533) |
| Política de retención y DSAR | [#533](https://github.com/cheloim/perExp/issues/533) |
| Revocación de sesión | [#536](https://github.com/cheloim/perExp/issues/536) |
| Redacción de PII en logs | [#526](https://github.com/cheloim/perExp/issues/526) |
| Autorización centralizada | [#524](https://github.com/cheloim/perExp/issues/524) |
| Gate de CVEs en CI | [#534](https://github.com/cheloim/perExp/issues/534) |

## Reportar una vulnerabilidad

No abras un issue público. Usá
[Private vulnerability reporting](https://github.com/cheloim/perExp/security/advisories/new)
o el canal descrito en `SECURITY.md`.
