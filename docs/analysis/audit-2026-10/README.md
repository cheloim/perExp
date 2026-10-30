# Auditoría de madurez · Octubre 2026

Informe completo e interactivo: **[abrir `index.html`](index.html)** (descargalo y abrilo en el
navegador; tiene filtros por severidad y búsqueda).

- **Commit auditado:** `333be7d`
- **Alcance:** 317 archivos TS/TSX · 122 archivos Python · 23 routers · 214 endpoints · 71 documentos
- **Resultado:** 106 hallazgos — **23 P1**, 66 P2, 17 P3

---

## Resumen

El producto no está en mal estado: `ruff`, `mypy`, `tsc` y `prettier` pasan; **711 tests** pasan;
el contrato OpenAPI coincide en **214 de 214** operaciones; los campos con PII están cifrados.

El problema es que **la app muestra números que no siempre son ciertos**, el login falla en
caminos válidos y la documentación describe un sistema que ya no existe.

| Dimensión | Estado |
|---|---|
| Confianza en los números | 3 definiciones distintas de "gasto"; ARS y USD se suman a valor nominal |
| Accesibilidad | `div`/`tr` clickeables, 60/72 labels sin `htmlFor`, contraste 2,2:1 |
| Autenticación | Flujo OAuth+MFA sin salida; token parcial de MFA con privilegios plenos |
| Backend | Import trunca a 20k caracteres; búsqueda descifra todo; 175 `except Exception` |
| Documentación | 42 de 71 documentos desactualizados; varios afirman cosas falsas |

## Los cuatro evolutivos

| Epic | Resultado esperado | Hijos |
|---|---|---|
| [#504 · Confianza en los números](https://github.com/cheloim/perExp/issues/504) | El mismo mes, el mismo total, en la moneda correcta | 6 |
| [#505 · Experiencia accesible y confiable](https://github.com/cheloim/perExp/issues/505) | Operable con teclado, login que no bloquea, admin sin accidentes | 9 |
| [#506 · Plataforma y operación](https://github.com/cheloim/perExp/issues/506) | Features nuevas sin degradar latencia ni integridad | 10 |
| [#507 · Documentación y conocimiento](https://github.com/cheloim/perExp/issues/507) | Un documento canónico por tema, con gate en CI | 4 |

## Los 10 hallazgos que más importan

1. **ARS y USD se suman a valor nominal.** Un gasto de USD 100 consume $100 de un presupuesto
   en pesos ([#508](https://github.com/cheloim/perExp/issues/508)).
2. **Tres definiciones de "gasto".** Dashboard excluye ingresos, Gastos los incluye
   ([#509](https://github.com/cheloim/perExp/issues/509)).
3. **Los drilldowns pierden el filtro.** "Deuda tarjetas" abre todos los gastos
   ([#510](https://github.com/cheloim/perExp/issues/510)).
4. **Una caída de red se ve como "$ 0"** ([#511](https://github.com/cheloim/perExp/issues/511)).
5. **OAuth + MFA deja al usuario en un callejón sin salida**
   ([#514](https://github.com/cheloim/perExp/issues/514)).
6. **El callback de Telegram acepta `?token=` sin validar `state`**
   ([#515](https://github.com/cheloim/perExp/issues/515)).
7. **Acciones admin destructivas con un click y sin gate de rol en el cliente**
   ([#516](https://github.com/cheloim/perExp/issues/516)).
8. **Accesibilidad estructural y contraste** por debajo de WCAG 2.2 AA
   ([#517](https://github.com/cheloim/perExp/issues/517), [#518](https://github.com/cheloim/perExp/issues/518)).
9. **El import trunca a 20.000 caracteres sin avisar** y descarta importes es-AR
   ([#522](https://github.com/cheloim/perExp/issues/522)).
10. **La búsqueda descifra todos los gastos en cada tecla**
    ([#523](https://github.com/cheloim/perExp/issues/523)).

## Seguridad

Cinco vulnerabilidades se registraron como **Security Advisories privados**, no como issues
públicos, porque el repositorio es público:

| ID | Tema | Severidad |
|---|---|---|
| `GHSA-x54h-5rqj-mh63` | Bypass de MFA | Crítica |
| `GHSA-p86h-c2xv-j859` | Administrador sembrado con credenciales por defecto | Crítica |
| `GHSA-gwvx-c53m-33h4` | Fuga entre tenants en deduplicación | Alta |
| `GHSA-3p3m-cw22-v8wp` | Agotamiento del pool vía SSE | Alta |
| `GHSA-9mpx-qm3j-6836` | Credencial de base commiteada | Alta |

<https://github.com/cheloim/perExp/security/advisories>

## Método

Inventario completo de frontend y backend, y análisis profundo de 14 módulos elegidos por
tamaño, criticidad y superficie de falla. Cada hallazgo cita `archivo:línea`. Los P1 de
seguridad y las afirmaciones más delicadas de documentación se verificaron leyendo el código,
no aceptando el reporte del subagente.

**Límites:** no se levantó la aplicación ni se inspeccionó en runtime; no se introspeccionó
PostgreSQL ni se midió cobertura real; no se validaron CVEs de dependencias ni la configuración
de producción.

## Documentación corregida en este lote

- `.env.example` + [Configuration](../Configuration.md) — quickstart ejecutable.
- [Authentication](../Authentication.md) y [Security](../Security.md) — reescritos contra el código.
- [Frontend](../Frontend.md), [Data-Model](../Data-Model.md), [API-Reference](../API-Reference.md).
- Nuevos: [matriz de autoridad](../README.md), [Design System](../Design-System.md),
  [Accesibilidad](../Accessibility.md), [Migraciones](../Migrations.md).
- Históricos movidos a [`docs/archive/`](../archive/).
