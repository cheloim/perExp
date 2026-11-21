# Threat model

Modelo de amenazas de Oikonomia: qué protegemos, de quién, por dónde se puede
entrar y qué riesgos quedan abiertos. Es un documento vivo; se actualiza cuando
cambia la arquitectura, una integración o un control de seguridad.

Documentos relacionados:

- [`Security.md`](Security.md): controles y vulnerabilidades conocidas.
- [`Key-Management.md`](Key-Management.md): `SECRET_KEY`, cifrado y ausencia de
  rotación.
- [`Authentication.md`](Authentication.md): sesiones, MFA, OAuth y refresh.
- [`specs/architecture/security-model.md`](specs/architecture/security-model.md):
  modelo técnico histórico. Si contradice a `Security.md` o `Authentication.md`,
  mandan esos dos.
- [`Family-Groups.md`](Family-Groups.md), [`Smart-Import.md`](Smart-Import.md),
  [`AI-Integration.md`](AI-Integration.md): superficies de tenancy, import y LLM.

## Alcance

Incluye:

- La plataforma web, el backend FastAPI, Postgres, Redis, Celery y los bots.
- La autenticación propia, Google OAuth, Telegram y WhatsApp.
- El pipeline de importación y las llamadas al LLM.
- El panel admin, la impersonación y los logs de auditoría.
- El server de producción, los backups y el deploy por GitHub Release.

No incluye:

- La seguridad interna de OpenAI, Google, Meta, Telegram, GitHub o Grafana
  Cloud. Se modelan como dependencias externas.
- Ataques físicos al server más allá del riesgo de robo de disco.
- Ingeniería social contra el dueño del proyecto.
- Seguridad del navegador del usuario final.

## Arquitectura y límites de confianza

```
Internet
  │  TLS
  ▼
nginx :443  ──►  landing (oikonomia.ar)
  │         ──►  platform-frontend (platform.<dominio>)
  │         ──►  grafana.<dominio>
  │
  └── /api/ ──►  backend FastAPI :8000
                    │
                    ├──► Postgres (red interna, sin TLS)
                    ├──► Redis DB 0 (broker) / DB 2 (cache)
                    ├──► Celery worker + beat
                    ├──► OpenAI / Google (texto, visión, audio)
                    ├──► Resend (emails)
                    └──◄ Meta Cloud API (webhook WhatsApp)

telegram_bot (contenedor aparte) ──► Telegram ──► Postgres/Redis

GitHub Actions ──► SSH ──► server; GHCR ──► imágenes
Let's Encrypt ──► certificados; Grafana Cloud ──► métricas/logs
```

Límites de confianza relevantes:

| Límite | Qué cruza | Control |
|---|---|---|
| Internet → nginx | HTTP/TLS, webhooks | TLS, CSP, headers, rate limit en app |
| nginx → backend | `/api/` | Proxy interno; no hay mTLS |
| backend → DB/Redis | Datos y colas | Red Podman compartida; sin TLS |
| backend/bots → LLM | Extractos, nombres, descripciones | Clave por feature, presupuesto, sin redacción |
| Meta/Telegram → backend | Mensajes y eventos | HMAC de WhatsApp; initData/HMAC de Telegram |
| admin → datos de usuario | Soporte con impersonación | Consentimiento, step-up, expiración, auditoría |
| host → backups | Dump completo | Mismo disco; sin cifrado del dump |
| CI/CD → server | Imágenes, `.env`, secretos | SSH, secretos de GitHub, `.env` 600 |

## Activos

| Activo | Ejemplos | Dónde vive | Sensibilidad |
|---|---|---|---|
| Datos financieros | Gastos, montos, fechas, tarjetas, cuentas, inversiones, presupuestos | Postgres | Alta |
| Extractos e importaciones | PDF/CSV/XLSX, texto crudo, preview con descripciones | Postgres (`import_jobs`), 24 h | Muy alta |
| Identidad y PII | Nombre, email, teléfono, Telegram chat ID, IP/user-agent | Postgres, logs, auditoría | Alta |
| Sesiones | Access JWT, refresh tokens, cookies, MFA secrets | Navegador, Postgres, Redis | Muy alta |
| Grupos familiares | Membresías, invitaciones, datos compartidos | Postgres | Alta |
| Secretos de operación | `SECRET_KEY`, password de DB, claves LLM, tokens de bots, admin de Grafana | `.env` del server, GitHub Secrets, Grafana | Crítica |
| Backups | Dump completo de la base | `/opt/creditcardanalyzer/backups` | Muy alta |
| Auditoría | Login, MFA, acciones admin, impersonación | `audit_logs`, `platform_logs` | Alta |
| Prompts y respuestas LLM | Extracto, nombre completo, descripciones, análisis | Memoria del proceso; proveedor externo | Alta |
| Disponibilidad | API, imports, bots, reportes | Server único | Alta |

## Actores

| Actor | Motivación / capacidad |
|---|---|
| Usuario legítimo | Acceder a sus datos; puede cometer errores o reusar passwords |
| Miembro de grupo | Ver datos compartidos; no debería ver los de otro grupo |
| Admin / soporte | Gestionar usuarios; puede impersonar con consentimiento |
| Anónimo de Internet | Escanear, probar credenciales, abusar del registro o del LLM |
| Usuario autenticado malicioso | Escalar a datos de otro tenant, agotar presupuesto, subir archivos |
| Cuenta comprometida | Usar sesión válida para exfiltrar o modificar datos |
| Operador / insider | Acceso al server, `.env`, backups y DB |
| Proveedor externo | OpenAI, Google, Meta, Telegram, GitHub, Grafana Cloud |
| Cadena de suministro | Dependencias, imágenes, GitHub Actions |
| Escáner automatizado | Fuerza bruta, CVEs conocidos, endpoints expuestos |

## Mapa de datos personales

| Dato | Dónde | Cifrado en la app | Retención |
|---|---|---|---|
| Nombre completo | `users.full_name` | Sí (`EncryptedType`) | Hasta borrado de cuenta |
| Email | `users.email` | No (índice único) | Hasta borrado de cuenta |
| Password | `users.hashed_password` | bcrypt | Hasta cambio/borrado |
| Teléfono WhatsApp | `users.whatsapp_phone` | Sí + HMAC de lookup | Hasta desvincular/borrar |
| Chat ID de Telegram | `users.telegram_chat_id` | Sí + HMAC | Hasta desvincular/borrar |
| Refresh token | `refresh_tokens.token_hash` | Sólo SHA-256 | 30 días / revocación |
| MFA secret | `users.mfa_secret` | Sí | Hasta desactivar MFA/borrar |
| Google refresh token | `users.google_refresh_token` | Sí | Hasta desvincular/borrar |
| Gastos, montos, fechas | `expenses`, `scheduled_expenses` | Descripción sí; montos/fechas no | Hasta borrado de cuenta |
| Tarjetas y cuentas | `cards`, `accounts` | Nombre/banco sí | Hasta borrado de cuenta |
| Extracto importado | `import_jobs.file_content` / `preview_data` | **No** | 24 h (cleanup diario) |
| Análisis de IA | `analysis_history.question` / `result_text` | **No** | Sin TTL automático |
| Reporte mensual | `monthly_reports.report_data` | Sí; `png_data` no | Hasta borrado de cuenta |
| Auditoría | `audit_logs` | IP/user-agent sí; `details` no | 90 días |
| Impersonación | `impersonation_messages` | No | 45 días |
| Logs de plataforma | `platform_logs` | Redacción parcial | 45 días |
| Logs de infra | `journal.log`, Loki | Redacción parcial | 15 días (Loki) |
| Backups | `db_*.dump` | Campos cifrados; el resto no | 15 días |

Conclusiones del mapa:

- El cifrado es **por columna**, no del volumen. Quien accede a Postgres ve
  emails, montos, fechas y relaciones.
- `import_jobs` y `analysis_history` son los puntos con más PII en claro. El
  primero se borra a las 24 h; el segundo no tiene TTL.
- Los backups y los logs extienden la vida de los datos más allá del borrado de
  la cuenta. No hay borrado inmediato en backups.

## STRIDE abreviado

| Letra | Amenaza representativa | Control existente | Estado |
|---|---|---|---|
| **S**poofing | Robo de sesión, webhook falso, OAuth/Telegram falsificado | JWT corto, refresh rotativo, HMAC de webhooks, verificación de IdP | Parcial |
| **T**ampering | Modificar gastos ajenos, inyectar transacciones vía import, alterar backups | Filtros por usuario, preview con confirmación, permisos de archivo | Parcial |
| **R**epudiation | Negar una acción admin o un cambio de datos | `audit_logs` para login/MFA/admin; no cubre todo | Parcial |
| **I**nformation disclosure | Fuga entre tenants, PII en logs, datos enviados al LLM, backup robado | Cifrado de columnas, redacción, HMAC, permisos | Parcial |
| **D**enial of service | Agotar pool con SSE, fuerza bruta, inflar cola de imports, agotar presupuesto LLM | Rate limits, timeouts, budget, alertas | Parcial |
| **E**levation of privilege | Bypass de MFA, admin por credenciales por defecto, impersonación | MFA opcional, sin admin sembrado, step-up + consentimiento | Parcial |

## Superficies y riesgos

### 1. Autenticación y sesión

| ID | Amenaza | Mitigación existente | Riesgo residual | Estado |
|---|---|---|---|---|
| A1 | Fuerza bruta / credential stuffing | Rate limit de login (10/min), lockout 5 fallos/15 min, bcrypt | El límite usa el primer `X-Forwarded-For`, falsificable detrás de nginx (#530) | Pendiente |
| A2 | Robo de access token | JWT 60 min, cookies `httpOnly`/`secure`/`sameSite=lax`, refresh rotativo con detección de reuso | No hay revocación instantánea del access token (#536) | Aceptado |
| A3 | Bypass de MFA | TOTP opcional, token parcial de 5 min, chequeo de `scope` | Advisory `GHSA-x54h-5rqj-mh63` figura como crítico abierto; no se replica detalle | Pendiente |
| A4 | Admin sembrado con password conocida | El arranque no crea admin; se crea con `scripts.create_admin` | Advisory `GHSA-p86h-c2xv-j859`; verificar que producción no tenga una cuenta sembrada | Pendiente |
| A5 | OAuth/Telegram falsificado | Google ID token verificado; Telegram initData con HMAC del bot token | Compromiso de la cuenta Google/Telegram del usuario | Aceptado |
| A6 | CSRF | `SameSite=Lax` + CORS explícito + cookies `secure` | No hay token CSRF explícito; revisar si se agregan flujos cross-site | Aceptado |
| A7 | Reset de password abusado | Token aleatorio con expiración, respuesta uniforme en forgot, rate limit | El token se guarda en claro en `users.reset_token` | Aceptado |
| A8 | Agotar el pool de conexiones con SSE | Rate limit de análisis; timeouts de app | Advisory `GHSA-3p3m-cw22-v8wp`; las conexiones SSE largas pueden consumir el pool | Pendiente |

### 2. Tenancy y grupos familiares

| ID | Amenaza | Mitigación existente | Riesgo residual | Estado |
|---|---|---|---|---|
| T1 | IDOR: ver o modificar datos de otro usuario/grupo | Filtros por `user_id` y por miembros aceptados | **No hay RLS**; 136 chequeos inline y copias divergentes de `get_group_user_ids` (#524) | Pendiente |
| T2 | Fuga en deduplicación de import | Dedup por usuario en el flujo normal | `GHSA-gwvx-c53m-33h4`: la dedup no filtraba por usuario; la corrección y la centralización siguen en #524 | Pendiente |
| T3 | Adivinar código de invitación | Código de 8 caracteres alfanuméricos (~62^8), invitación pendiente | `/groups` no tiene rate limit específico para probar códigos | Aceptado |
| T4 | Miembro removido sigue viendo datos | Membresía `accepted` consultada en cada request | No se revisó la invalidación de SSE/cache al remover un miembro | Pendiente |

### 3. Webhooks y bots

| ID | Amenaza | Mitigación existente | Riesgo residual | Estado |
|---|---|---|---|---|
| W1 | POST falso a WhatsApp | `X-Hub-Signature-256` con `WHATSAPP_APP_SECRET`; en producción el backend no arranca sin el secret | Si el secret se filtra, se pueden inyectar mensajes | Aceptado |
| W2 | Replay de mensaje de WhatsApp | Dedup por `message_id` en Redis por 7 días | Pasados 7 días, un replay podría reprocesarse | Aceptado |
| W3 | GET de verificación con token adivinado | `WHATSAPP_VERIFY_TOKEN` | Token en query string puede quedar en logs de proxy | Aceptado |
| W4 | Bot de Telegram duplicado | Un solo contenedor `telegram_bot`; plataforma con `TELEGRAM_BOT_ENABLED=false` | Un deploy mal configurado puede levantar dos pollers (409) | Pendiente |
| W5 | Mensaje de bot con PII | Los mensajes se procesan y no se persisten como media | Telegram/Meta retienen el mensaje fuera de nuestro control | Aceptado |

### 4. Importación

| ID | Amenaza | Mitigación existente | Riesgo residual | Estado |
|---|---|---|---|---|
| I1 | Archivo malicioso o bomb | Límite de 10 MB y allowlist de extensión (`.pdf`, `.csv`, `.xls`, `.xlsx`) | No se valida MIME/magic ni zip bomb; un XLSX comprimido puede expandir mucho | Pendiente |
| I2 | Prompt injection en el extracto | El LLM sólo produce un preview; el usuario confirma antes de crear gastos | Un extracto manipulado puede generar filas falsas o saltar el filtro de titular | Aceptado |
| I3 | Duplicados o pérdida de datos | Dedup en dos capas, lock por usuario, confirmación | Un lock vencido o un worker muerto deja jobs `PROCESSING` hasta el cleanup | Aceptado |
| I4 | PII en claro | `file_content` y `preview_data` en Postgres | No están cifrados; retención 24 h | Aceptado |
| I5 | Agotar la cola | Rate limit por usuario, concurrencia 2, timeout 10 min | Un usuario puede encolar varios imports; no hay cuota global por usuario | Aceptado |

### 5. LLM

| ID | Amenaza | Mitigación existente | Riesgo residual | Estado |
|---|---|---|---|---|
| L1 | Fuga de datos al proveedor | Claves separadas por feature; presupuesto; sin retención local de media | El extracto, el nombre completo y las descripciones se envían a OpenAI/Google; la retención del proveedor no está bajo nuestro control | Aceptado |
| L2 | Prompt injection desde un extracto | Salida usada como preview, no auto-aplicada | El modelo puede omitir o inventar transacciones; el usuario tiene que revisar | Aceptado |
| L3 | Abuso de presupuesto | `LLM_MONTHLY_BUDGET_USD`, rate limits de import/análisis/captura | No hay cuota por usuario; uno puede consumir el presupuesto global | Aceptado |
| L4 | Clave filtrada | Claves en `.env`/GitHub Secrets, no en logs | Si se filtra, el atacante gasta la cuenta hasta que se rote | Pendiente |
| L5 | Métricas ciegas | Redis registra uso y Prometheus lo expone | Si Redis falla, el control de presupuesto falla abierto | Aceptado |

### 6. Admin, auditoría e impersonación

| ID | Amenaza | Mitigación existente | Riesgo residual | Estado |
|---|---|---|---|---|
| E1 | Compromiso de una cuenta admin | `is_admin` verificado en backend, step-up con password + MFA si está habilitado, rate limit | MFA no es obligatorio para admins; una password filtrada alcanza | Pendiente |
| E2 | Impersonación sin consentimiento | Solicitud al usuario, expiración 30 min, transcripción por email, auditoría | Un admin comprometido puede pedir y obtener acceso si el usuario acepta | Aceptado |
| E3 | Acciones admin sin rastro | `audit_logs` para login/MFA/admin, retención 90 días | No todas las acciones de usuario se auditan; `details` puede tener PII | Pendiente |
| E4 | Panel admin descubierto | Slug no adivinable + `noindex` | El slug es oscuridad, no autorización; el backend sí valida `is_admin` | Aceptado |
| E5 | Logs con PII | `RedactPiiFilter` en app y `platform_logs`; query strings fuera del access log | La redacción es por patrón y no cubre todo (#526) | Pendiente |

### 7. Infraestructura, secretos y backups

| ID | Amenaza | Mitigación existente | Riesgo residual | Estado |
|---|---|---|---|---|
| P1 | Acceso directo a Postgres/Redis | Red Podman `oikonomia`; nginx no los publica | `docker-compose.infra.yml` publica `5432` y `6379` en el host; la exposición depende del firewall | Pendiente |
| P2 | Robo del disco | Campos sensibles cifrados | No hay cifrado de volumen; emails, montos y fechas quedan legibles | Aceptado |
| P3 | Pérdida de `SECRET_KEY` | Backup en gestor de passwords + sobre físico | Cambiarla o perderla deja ilegibles los campos cifrados; no hay rotación soportada | Aceptado |
| P4 | Backup robado o perdido | Dump verificado, retención 15 días, permisos del server | Mismo disco, sin cifrado, sin copia offsite | Aceptado |
| P5 | Secreto en `.env` mal protegido | `.env` 600, secretos de GitHub, deploy por SSH | `.env.rollback.platform` también contiene secretos; el operador puede leerlos | Aceptado |
| P6 | Cadena de suministro | Dependabot, imágenes de GHCR, workflows del repo | Acciones por tag mutable; no hay gate de CVEs (#534) | Pendiente |
| P7 | DDoS / escaneo | Rate limits de app, nginx, TLS | No hay WAF ni protección de red dedicada | Aceptado |
| P8 | Métricas y health públicos | `/metrics` bloqueado en nginx; `/health` no revela datos | El puerto 8000 del host puede exponer `/metrics` si el firewall lo permite | Pendiente |
| P9 | Credencial de base commiteada | Rotación de la password y secretos fuera de git | Advisory `GHSA-9mpx-qm3j-6836`; verificar que la credencial vieja no siga válida | Pendiente |

### 8. Privacidad y borrado

| ID | Amenaza | Mitigación existente | Riesgo residual | Estado |
|---|---|---|---|---|
| D1 | Borrado de cuenta incompleto | `services/account_deletion.py` borra tablas principales y sale del grupo | `audit_logs` conserva la fila con `user_id NULL`; `details` puede tener PII por 90 días | Pendiente |
| D2 | Datos en backups tras el borrado | Retención de 15 días | No hay borrado selectivo en dumps; hay que esperar la rotación | Aceptado |
| D3 | Datos en logs tras el borrado | Retención 15/45 días | Los logs no se purgan por usuario | Aceptado |
| D4 | DSAR / exportación | Borrado y edición desde la app | No hay exportación completa ni plazo formal de respuesta | Pendiente |

## Riesgos aceptados explícitamente

Se aceptan hoy, con estas condiciones:

1. **Server único, sin HA.** Un fallo de host es una caída total. Mitigación:
   backups y runbooks, no réplicas.
2. **Sin cifrado en reposo del volumen.** El cifrado por columna protege PII
   seleccionada; el resto depende del acceso físico y del firewall.
3. **Sin copia offsite.** El backup vive en el mismo disco. Es el riesgo más
   caro: si se pierde el disco, se pierden datos y backups. Prioridad alta para
   el próximo ciclo.
4. **Sin rotación de `SECRET_KEY`.** Rotarla hoy pierde datos cifrados. Si se
   sospecha compromiso, se trata como incidente, no como cambio de rutina.
5. **LLM como procesador externo.** Enviar extractos y nombres a OpenAI/Google
   es parte del producto. No hay DPA ni retención cero verificada en este repo.
6. **Impersonación asistida.** Un admin puede ver la cuenta con consentimiento
   del usuario y trazabilidad; se acepta para soporte.
7. **Sin WAF ni 24/7.** El proyecto es personal; los SLOs son operativos.
8. **MFA opcional.** No se obliga a los usuarios ni a los admins; se acepta el
   riesgo de cuentas sin segundo factor.

## Riesgos pendientes priorizados

| Prioridad | Riesgo | Por qué | Issue / referencia |
|---|---|---|---|
| Alta | Aislamiento multi-tenant sin RLS ni autorización centralizada | Un filtro olvidado es una fuga entre usuarios | #524, `GHSA-gwvx-c53m-33h4` |
| Alta | Bypass de MFA | El token parcial es una superficie crítica | `GHSA-x54h-5rqj-mh63` |
| Alta | Agotamiento del pool por SSE | Un cliente puede dejar sin conexiones a la API | `GHSA-3p3m-cw22-v8wp` |
| Alta | Credencial de base commiteada | Hay que confirmar que la password vieja no abre nada | `GHSA-9mpx-qm3j-6836` |
| Alta | Backup sin copia offsite | Pérdida del disco = pérdida total | `Deployment.md`, este documento |
| Alta | `SECRET_KEY` sin rotación | Compromiso = datos cifrados irrecuperables | `Key-Management.md` |
| Media | PII en logs y `platform_logs` | Retención 45 días y redacción parcial | #526 |
| Media | Rate limit con `X-Forwarded-For` falsificable | Evasión de brute force | #530 |
| Media | MFA no obligatorio para admins | Una password comprometida da acceso total | Este documento |
| Media | `import_jobs` y `analysis_history` en claro | PII financiera en DB y backups | Este documento |
| Media | Postgres/Redis publicados en el host | Exposición si el firewall falla | `docker-compose.infra.yml` |
| Baja | Gate de CVEs ausente | Dependencias vulnerables sin bloqueo | #534 |
| Baja | Validación de archivos por extensión | Zip bomb o archivo malformado | `import_jobs.py` |
| Baja | Sin rate limit en invitaciones de grupo | Prueba de códigos | `groups.py` |

## Controles que sí existen

- bcrypt para passwords; política de complejidad y verificación de email.
- JWT HS256 de 60 min; refresh opaco rotativo con SHA-256 y detección de reuso.
- Cookies `httpOnly`, `secure`, `sameSite=lax`; CORS con lista explícita.
- MFA TOTP opcional y token parcial de 5 min con `scope`.
- Rate limit en login, registro, MFA, reset, refresh, import, análisis, captura y
  step-up de admin.
- Cifrado por columna con Fernet (`EncryptedType`) y HMAC para lookups.
- Aislamiento por `user_id` y grupos con membresía aceptada (sin RLS).
- Webhook de WhatsApp con HMAC SHA-256; Telegram con validación de `initData`.
- Upload de import limitado a 10 MB y extensiones permitidas.
- Admin con step-up, impersonación con consentimiento y expiración, auditoría.
- Secretos fuera de git; `.env` 600 en el server; imágenes en GHCR.
- Backups verificados con `pg_restore --list` y alerta de staleness.
- TLS en nginx, HSTS, CSP, headers de seguridad, `/metrics` bloqueado en el borde.
- Logs con filtro de PII y retención acotada (45 días DB, 15 días Loki).

## Qué haría falta para subir el nivel

No es un roadmap comprometido; es el orden que reduce más riesgo por esfuerzo:

1. Copia offsite cifrada de los backups y prueba de restauración periódica.
2. RLS o una capa única de autorización por tenant, con tests de fuga.
3. Cerrar los advisories de MFA y credenciales sembradas.
4. Obligar MFA a admins y revisar la impersonación.
5. Cifrar o acortar la retención de `import_jobs` y `analysis_history`.
6. Sacar los puertos de Postgres/Redis del host y documentar el firewall.
7. Gate de CVEs y pinneo de GitHub Actions por SHA.
8. Política de retención/DSAR con exportación y borrado verificable.

## Revisión

Se revisa al menos una vez por trimestre y ante:

- Un cambio de autenticación, tenancy, import o LLM.
- Un incidente de seguridad o una fuga de datos.
- Una integración nueva (otro proveedor, otro bot, otro broker).
- Un cambio en el deploy, los secretos o los backups.

Si un riesgo deja de ser aceptado, se abre un issue con dueño, mitigación y
fecha. Si un control desaparece, este documento se corrige en el mismo PR.
