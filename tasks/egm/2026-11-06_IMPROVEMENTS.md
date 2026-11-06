# Oportunidades de mejora del producto

**Fecha:** 2026-11-06

**HEAD revisado:** `cafb211b040fbabe87a06cf9d62863c6ff67ce0c`

**Supuesto de carga:** beta multi-tenant con varios workspaces privados y tres monitores activos por workspace como límite predeterminado. Los monitores retirados y sus ejecuciones conservan historial; no se midió volumen real ni carga de producción.

Este informe registra cuatro mejoras que surgen del código actual. Se completaron tres revisiones técnicas de Luna —fiabilidad del análisis, experiencia de uso/operabilidad y coste de consultas/crecimiento— y una revisión EGM fresca de Zoom-Out. Es una revisión técnica directa, no la revisión EGM completa de cinco etapas. La primera oportunidad tiene una reproducción aislada con reloj simulado; las demás se basan en lectura estática. La revisión de Zoom-Out ajustó el orden y el alcance de la oportunidad de escala. No se usó navegador, no se iniciaron servicios ni se midió producción. El informe de drift existente queda separado: las diferencias de tipografía no son el hallazgo principal aquí.

| Orden | Oportunidad | Evidencia | Esfuerzo |
|---|---|---|---|
| 1 | El límite de tiempo del análisis no cubre el bucle de hallazgos | Reproducción controlada + lectura estática | M |
| 2 | El historial de ejecuciones deja de mostrar resultados después de 50 | Lectura estática | M |
| 3 | Los errores del worker pierden su causa en los logs | Lectura estática | S |
| 4 | Medir el crecimiento del listado de monitores antes de optimizarlo | Lectura estática | S para medir; M si las mediciones lo justifican |

## 1. El límite de tiempo del análisis no cubre el bucle de hallazgos

**Caso y efecto:** un contrato con muchos cambios de operaciones puede gastar tiempo comparando cada uso de código con cada hallazgo. El control del límite cooperativo se consulta antes de recorrer esa lista, pero no dentro de ese bucle; por eso el analizador puede seguir contabilizando el archivo como completo cuando el presupuesto ya pasó.

**Evidencia y confianza:** la reproducción llamó al analizador real con documentos OpenAPI que contienen `info` y 1.000 hallazgos `BREAKING` de operaciones GET retiradas. La fixture JSON de `CheckFinding` entregada directamente al analizador pesó 194.781 bytes; es menor que el límite de 2 MiB configurado para `oasdiff`, pero no representa ni mide su salida real porque el probe no ejecutó `oasdiff`. Incluyó un archivo de 44 bytes con un `fetch` compatible. Un reloj falso avanzó 10 ms por comparación: al volver, marcaba 20.000 ms frente al límite de 1.500 ms; el archivo seguía contado como analizado y no apareció el motivo de límite de tiempo. Esto reproduce la falta de comprobación, no mide 20 segundos de tiempo real ni demuestra agotamiento de memoria. El control en [impact-analyzer.ts](../../src/lib/impact-analyzer.ts#L565) precede al bucle de hallazgos en [impact-analyzer.ts](../../src/lib/impact-analyzer.ts#L596), y el resultado se recorta a 80 evidencias recién al final en [impact-analyzer.ts](../../src/lib/impact-analyzer.ts#L655). La acumulación temporal por encima de 80 es una observación estática independiente; la reproducción devolvió cero evidencias, así que no verificó ese efecto.

**Cambio mínimo:** consultar el reloj también dentro del recorrido de hallazgos y dejar el resultado de cobertura como parcial cuando el presupuesto se agota. Limitar la evidencia retenida mientras se agrega, conservando una marca para indicar que se alcanzó el tope y la razón de cobertura parcial. Mantener el límite cooperativo: una comprobación periódica no interrumpe por sí sola una operación síncrona individual.

**Beneficio:** el usuario recibe una indicación honesta de análisis incompleto y el worker dedica menos trabajo a comparar hallazgos que ya no caben en el presupuesto.

**Aceptación:** una prueba con reloj controlado que avance dentro del bucle debe producir la razón de límite de tiempo, no contar el archivo incompleto como analizado y marcar cobertura parcial. Un caso con más de 80 evidencias debe devolver como máximo 80, informar el recorte y no requerir acumularlas todas en memoria.

## 2. El historial de ejecuciones deja de mostrar resultados después de 50

**Caso y efecto:** una persona vuelve meses después a revisar su primera línea base o una rotura antigua. El endpoint devuelve solo las 50 ejecuciones más recientes, y la pantalla no ofrece un control para consultar las anteriores; los registros más viejos siguen guardados, pero no son accesibles desde este recorrido.

**Evidencia y confianza:** lectura estática de [monitor-checks.ts](../../src/lib/monitor-checks.ts#L139), [route.ts](../../src/app/api/monitors/[id]/checks/route.ts#L25) y [monitor-check-panel.tsx](../../src/components/monitor-check-panel.tsx#L228). `take: 50` fija el límite y la interfaz solo representa la lista recibida. No se encontró cursor ni acción “ver anteriores”.

**Cambio mínimo:** agregar cursor y una acción “Cargar ejecuciones anteriores”, conservando la primera página, el orden y el filtro por workspace. No cambiar el resumen de cada ejecución.

**Beneficio:** la historia prometida sigue siendo útil a medida que el monitor acumula checks.

**Aceptación:** con más de 50 ejecuciones, la primera carga muestra las más nuevas y cada carga adicional permite alcanzar la más antigua sin duplicados; otra cuenta sigue recibiendo únicamente los datos de su workspace.

## 3. Los errores del worker pierden su causa en los logs

**Caso y efecto:** al ejecutar `npm run worker:monitoring`, falta `DATABASE_URL` o PostgreSQL/pg-boss no puede conectarse. El proceso termina con un mensaje idéntico para cualquier excepción. Los handlers de error y advertencia de pg-boss también omiten el detalle. Quien opera el worker no puede distinguir configuración ausente, conexión rechazada o problema de cola usando esos logs.

**Evidencia y confianza:** lectura estática de [monitor-worker.ts](../../scripts/monitor-worker.ts#L14) y [monitor-queue.ts](../../src/lib/monitor-queue.ts#L23). `main` descarta el objeto de error en `catch`, y los listeners no consumen el argumento del evento. `monitor-queue.ts` sí valida la ausencia de `DATABASE_URL` con un error concreto, pero `main` oculta esa causa. No se inició el worker para reproducirlo.

**Cambio mínimo:** registrar un código o tipo de error seguro junto con la operación (inicio del worker, conexión, cola, apagado). Mantener mensajes de usuario genéricos y no volcar cadenas de conexión, payloads ni errores que puedan incluir credenciales.

**Beneficio:** la persona que configura o mantiene el servicio puede encontrar la causa sin exponer secretos.

**Aceptación:** escenarios controlados de configuración ausente, base no disponible y error de cola producen diagnósticos distintos y accionables; una revisión de salida confirma que no aparecen URL, contraseña ni payload sensible.

## 4. Medir el crecimiento del listado de monitores antes de optimizarlo

**Caso y efecto:** un workspace puede acumular monitores retirados al crear y retirar registros repetidamente. El límite predeterminado de tres aplica a monitores activos, no al historial. `listMonitors` carga todos los registros del workspace y calcula cada vista con consultas adicionales; `monitorView` también vuelve a resolver el entitlement para cada monitor. Esto puede hacer crecer filas y consultas con el tiempo, pero no se midió el tamaño actual de workspaces ni la latencia del listado.

**Evidencia y confianza:** lectura estática de [monitors.ts](../../src/lib/monitors.ts#L95), [monitors.ts](../../src/lib/monitors.ts#L155) y [beta-policy.ts](../../src/lib/beta-policy.ts#L50). El límite activo predeterminado es tres y puede configurarse hasta 50; no limita los registros `WITHDRAWN`. `getMonitor` ya resuelve el detalle de un solo monitor dentro del workspace en [monitors.ts](../../src/lib/monitors.ts#L164). La oportunidad es condicional: no hay evidencia de degradación actual ni mediciones de producción.

**Cambio mínimo:** primero registrar un punto de referencia de cantidad de monitores por workspace, consultas del listado y latencia observada. Como ajuste separado, resolver el entitlement una vez por solicitud de listado y reutilizarlo al formar cada vista. Dejar la paginación y la agrupación más amplia de consultas para cuando las cantidades y medidas observadas muestren que hacen falta; no fijar un umbral sin datos.

**Beneficio:** se evita repetir la misma consulta de política; las mediciones permiten decidir si hace falta acotar o agrupar el resto del trabajo.

**Aceptación:** una prueba confirma que el listado conserva las mismas vistas y filtros, y resuelve el entitlement una vez por solicitud. Registrar cantidad de monitores, número de consultas y latencia del listado en el beta; decidir si agregar paginación o lecturas agrupadas a partir de esos datos. Una prueba de aislamiento mantiene el filtro por workspace.

La posibilidad de retirar monitores después del vencimiento de un workspace no se incluye como defecto: ese estado puede ser una acción de limpieza segura y la propiedad del workspace ya se valida. Conviene definir esa excepción de política y fijarla con una prueba antes de decidir si se debe bloquear.

**Verificación:** se contrastaron las rutas citadas y la evidencia de la reproducción con el código del HEAD indicado. El orden se ajustó tras una pasada de Zoom-Out. No se midió latencia real ni se ejecutó la revisión EGM completa de cinco etapas.
