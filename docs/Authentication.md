# Autenticación y sesiones

> Reescrito el 2026-10-30 contra el código real (`src/backend/app/routers/auth.py`,
> `routers/mfa.py`, `services/auth.py`). La versión anterior describía Apple Sign-In y un
> refresh token que **no existen**.

## Resumen

- **JWT propio** firmado con `JWT_SECRET` (fallback `SECRET_KEY`), HS256.
- **Un solo token de acceso de 7 días.** No hay refresh token separado: `/auth/refresh`
  reemite un token nuevo si el actual sigue vigente.
- **Cookie HTTP-only** `oikonomia_auth` además del bearer, para el flujo de Grafana.
- **Proveedor OAuth único: Google.** `/auth/oauth/callback` rechaza cualquier otro.
- **MFA TOTP** opcional por usuario.
- **Telegram** soporta login por WebApp, widget y OIDC.

## Flujos

### 1. Email y contraseña

```
POST /auth/login {email, password}
  ├─ usuario inactivo        → 403
  ├─ email no verificado     → 403 "Verificá tu email antes de iniciar sesión"
  ├─ credenciales inválidas  → 401 (incrementa contador de fallos)
  ├─ mfa_enabled             → 200 {access_token, mfa_required: true}   ← token de 5 min
  ├─ force_password_change   → 200 {access_token, force_password_change: true}
  └─ ok                      → 200 {access_token} + cookie HTTP-only
```

El token devuelto con `mfa_required` es un JWT de 5 minutos. Su alcance está bajo revisión
de seguridad en el advisory privado `GHSA-x54h-5rqj-mh63`; el detalle técnico no se publica
acá hasta que esté corregido. La corrección prevista introduce un claim `scope` que
distingue un access token completo de un token pendiente de segundo factor.

### 2. Segundo factor

```
POST /auth/login/mfa {email, code}     → token completo + cookie
POST /mfa/setup                        → secreto TOTP + QR
POST /mfa/verify {code}                → habilita MFA
POST /mfa/disable {code}               → deshabilita MFA
GET  /mfa/status                       → {enabled: bool}
```

TOTP de 30 segundos, emisor `NikoFin` en producción y `NikoFin (Dev)` en desarrollo.

### 3. Google OAuth

```
POST /auth/oauth/callback {provider: "google", code}
```

El frontend obtiene el `code` con Google Identity Services y lo canjea acá. No existe
`POST /auth/oauth` ni Apple Sign-In.

### 4. Telegram

| Endpoint | Uso |
|---|---|
| `POST /auth/telegram/webapp` | Login desde la Mini App (initData firmada) |
| `POST /auth/telegram/link-webapp` | Vincular la cuenta de Telegram a un usuario existente |
| `POST /auth/telegram/login-widget` | Login con el widget oficial |
| `POST /auth/telegram/oidc` | Inicio del flujo OIDC |
| `POST /auth/telegram/callback` | Callback OIDC |
| `POST /auth/telegram/link` | Vincular desde el bot |

### 5. Verificación de email

```
POST /auth/register            → crea usuario, envía email
POST /auth/verify-email        → consume el token
POST /auth/resend-verification → reenvía
```

### 6. Recuperación de contraseña

```
POST /auth/forgot-password {email}   → siempre 200 (no revela si existe)
POST /auth/reset-password {token, password}
```

El reset **no invalida** los tokens emitidos antes. Está trackeado en
[#536](https://github.com/cheloim/perExp/issues/536).

### 7. Sesión

```
GET  /auth/me
PUT  /auth/me                    → perfil
PUT  /auth/me/onboarding
PUT  /auth/password              → cambio de contraseña
POST /auth/force-change-password → cambio obligatorio
POST /auth/refresh               → reemite con token vigente
POST /auth/logout                → borra la cookie (no revoca el JWT)
```

## Modelo de sesión

| Aspecto | Implementación |
|---|---|
| Formato | JWT HS256, claim `sub` = user id |
| Vigencia | `JWT_EXPIRE_DAYS` (default 7) |
| Token parcial | 5 min, sin claim de scope (vulnerabilidad abierta) |
| Transporte | `Authorization: Bearer` + cookie `oikonomia_auth` |
| Cookie | `httpOnly`, `secure`, `sameSite=lax`, `path=/` |
| Revocación | **No existe.** `token_version` y `jti` son trabajo pendiente (#536) |

## MFA y contraseñas

- Hash: bcrypt vía `get_password_hash`.
- Bloqueo: contador de intentos por email/IP con ventana deslizante en Redis.
- Contraseña mínima: 8 caracteres, mayúscula, minúscula, número y símbolo.
- `force_password_change` se usa en cuentas sembradas y resets administrativos.

> El rate limit toma el **primer** valor de `X-Forwarded-For`, que nginx antepone: un
> cliente puede falsificarlo y evadir el límite (`GHSA` asociado, issue
> [#530](https://github.com/cheloim/perExp/issues/530)).

## Roles

| Rol | Cómo se determina |
|---|---|
| Usuario | Autenticado y activo |
| Admin | `User.is_admin == true` |
| Staff de un grupo | `GroupMember.role` con membresía `accepted` |

El panel `/x/:slug` **no** verifica el rol en el cliente; el backend sí. Es un hueco de UX
trackeado en [#516](https://github.com/cheloim/perExp/issues/516).

## Archivos relevantes

| Archivo | Responsabilidad |
|---|---|
| `routers/auth.py` | Endpoints de login, registro, sesión y OAuth |
| `routers/mfa.py` | Alta, verificación y baja de TOTP |
| `services/auth.py` | Emisión y validación de JWT, hash de contraseñas |
| `services/mfa.py` | TOTP y códigos de recuperación |
| `services/rate_limit.py` | Ventanas de intentos en Redis |
| `services/telegram_oidc.py` | Intercambio OIDC con Telegram |

## Verificación

```bash
cd src/backend
SECRET_KEY="test-secret-key-that-is-at-least-32-chars-long-for-testing" \
  pytest tests/test_auth*.py tests/test_mfa*.py -q
```
