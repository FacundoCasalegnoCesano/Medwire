# Verificación de monitores y preparación de fuentes

## Alcance

Este registro conserva la verificación original de la fase 2: crear, listar, editar y retirar monitores privados; comprobar fuentes OpenAPI y Git; y orientar a una cuenta nueva hasta que sus fuentes estén listas. La verificación posterior de ejecución, baseline e historial está en [`monitoring-verification.md`](monitoring-verification.md). `READY` en el flujo de preparación de fuentes no implica por sí solo que una ejecución esté en curso.

El contrato debe ser público, HTTPS, OpenAPI 3.0/3.1, JSON o YAML. Se comprueba la estructura básica y se resuelven referencias locales; esto no es una validación integral del estándar. Las referencias remotas y `$dynamicRef` (internas o externas) no están soportadas. Los repositorios públicos se consultan por HTTPS mediante Git Smart HTTP de solo lectura (`info/refs`); no se clona ni ejecuta su contenido. GitHub App, permisos de escritura, comparación de revisiones, análisis de código, ejecuciones, programación e historial quedan para fases posteriores.

## Comportamiento y límites implementados

- Los estados son `DRAFT`, `READY` y `WITHDRAWN`. Entradas URL malformadas, con credenciales, query string o fragmento se rechazan antes de persistir. URLs sintácticamente aceptadas cuya fuente falla por acceso, parser o protocolo dejan el monitor en `DRAFT` con el error junto al campo. Retirar conserva sus datos y reactivar vuelve a validar ambas fuentes.
- La sesión autenticada determina el workspace en las páginas y operaciones del servidor; las mutaciones API requieren `Origin` configurado y `application/json`, y leen como máximo 8 KiB de JSON.
- Cada conexión y redirección valida y fija una dirección IP pública. Se rechazan destinos locales, privados, link-local y de metadata, credenciales en URL, query strings y fragmentos. El cliente usa HTTPS/443, limita cada fuente a 5 s, el contrato a 1 MiB, la respuesta Git a 2 MiB y redirecciones a 3.
- Las respuestas se procesan como datos. No se guardan los cuerpos completos de contratos o repositorios ni se exponen credenciales en errores.
- La verificación histórica de esta fase no cubría baseline ni worker. La implementación actual de baseline, ejecución e historial está documentada por separado; siguen sin estar implementados los cobros y el contenido de demostración.

## Mapa y alcance del análisis

Graphify posterior al cambio: 287 nodos, 449 enlaces y 22 comunidades. La extracción AST local cubrió 49 archivos TS/TSX; no cubrió los archivos Prisma ni los dos SQL. Rutas de creación y edición pasan por la lectura acotada del JSON y los servicios de monitores, con autorización del workspace de sesión. El artefacto Graphify no forma parte de la verificación funcional.

## Verificación registrada

Verificación del equipo sobre este cambio:

- `npm run lint`: correcto.
- `npm run typecheck`: correcto.
- Validación de esquema Prisma: correcta.
- `npm test`: 54/54 pruebas correctas.
- `scripts/test-auth-integration.ps1`: 2/2 pruebas correctas contra la base local dedicada a pruebas `mendwire_test`.
- `npm run build`: correcto con Webpack.
- Migración aditiva `20261102000100_monitors`: aplicada a las bases locales `mendwire` y `mendwire_test` en `127.0.0.1`; SQL revisado y ejecución autorizada por la raíz.
- Recorrido real en `http://127.0.0.1:3000`: crear, persistir tras recarga, editar, retirar y reactivar pasaron; el acceso sin sesión redirigió a `/sign-in`; viewport de escritorio `1440×960`; vista móvil `390×844` sin overflow; tras Tab, el foco llegó a “Edit and check”; `pageErrors` vacío. Ese reporte histórico registró un `404` de recurso en `/favicon.ico`.
- Evidencia del recorrido: `.cache/browser-artifacts/2026-11-02T22-10-19.170Z-report.json` y capturas `2026-11-02T22-10-19.170Z-desktop-dashboard.png`, `2026-11-02T22-10-19.170Z-desktop-monitors.png` y `2026-11-02T22-10-19.170Z-mobile-monitors.png` dentro de `.cache/browser-artifacts/`. Se preservan estos archivos.
- El favicon se corrigió con `src/app/icon.svg`. `npm run build` terminó con código 0 e incluyó `/icon.svg` como ruta estática; evidencia en `.cache/favicon-build.log`. En una sesión de navegador nueva, sign-in y guard respondieron sin 404 ni errores de consola; `/icon.svg` respondió dos veces `200 image/svg+xml` y `notFound` quedó vacío. Esta comprobación posterior es separada del reporte histórico del CRUD.
- El agente limpió las 3 cuentas de prueba y, en total, 3 registros de cada tabla relacionada: `sessions`, `accounts`, `workspaces` y `monitors`. Verificación posterior de solo lectura con `node --env-file=.env .cache/verify-browser-cleanup.mjs`: salida 0, host `127.0.0.1`, base `mendwire`, `checkedIdentityCount: 3`, `users: 0`, relaciones en cero y `passed: true`.

La migración y las pruebas de base de datos corresponden al entorno local indicado; no son una migración ni una verificación de producción.

## Criterios y estado de aceptación

- [x] Crear, listar, editar y retirar monitores sin datos precargados; estados y fuentes quedan almacenados.
- [x] Las URLs sintácticamente aceptadas con fuentes inaccesibles o fallos de parser/protocolo quedan editables en `DRAFT` con errores por campo; URLs malformadas, con credenciales, query string o fragmento se rechazan antes de persistir.
- [x] Se aceptan documentos compatibles OpenAPI 3.0/3.1 JSON/YAML con referencias locales resolubles; referencias remotas y `$dynamicRef` se rechazan explícitamente. La comprobación de estructura no equivale a validación completa de OpenAPI.
- [x] Se consulta Git público HTTPS por Smart HTTP, sin clonar ni ejecutar el repositorio.
- [x] Las operaciones del monitor aplican aislamiento por workspace obtenido de la sesión.
- [x] Retirar conserva el registro; reactivar vuelve a validar. La interfaz presenta `READY` como fuentes listas, no como monitoreo activo ni baseline.
- [x] Las pruebas automatizadas cubren destinos no públicos, validación de DNS por conexión/redirección, redirecciones, límites, timeout y referencias OpenAPI no soportadas.
- [x] Confirmar en navegador el flujo inicial, lista, foco tras Tab y presentación móvil; el reporte histórico registró el `404` de `/favicon.ico`.
- [x] Corregir favicon con `src/app/icon.svg`; build correcto y sesión nueva confirma `/icon.svg` con `200 image/svg+xml`, sin 404 ni errores de consola en sign-in y guard.
- [x] Limpiar las 3 cuentas de prueba y sus datos derivados; consulta final de solo lectura confirma cero cuentas y relaciones. Se preservaron capturas y artefactos de evidencia.

El resultado cubre la funcionalidad local implementada y los checks listados. Las funciones posteriores enumeradas arriba no están implementadas.
