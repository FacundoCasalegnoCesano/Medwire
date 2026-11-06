# Mendwire — Propuesta de producto y arquitectura

Fecha: 2 de noviembre de 2026.

Estado: propuesta de planificación. Next.js es el stack indicado por el usuario; las demás elecciones son recomendaciones para el primer MVP. Las tareas detalladas están en [todo.md](todo.md).

## Objetivo y criterio de éxito

Un ingeniero conecta un contrato OpenAPI y un repositorio, recibe un cambio incompatible con evidencia del código afectado y puede revisar una propuesta y abrir una PR borrador cuando dispone de autorización. El primer resultado útil puede ser un hallazgo documentado que requiera intervención humana; una reparación automática depende de que exista una transformación justificable.

La carpeta local estaba vacía durante esta revisión. Los puntos 1 y 2 suministrados por el usuario son requisitos, no funcionalidades comprobadas. El objetivo de este trabajo es completar la planificación.

## Referencia visual y alcance local

Referencia aportada por el usuario: [landing conceptual de Mendwire](https://mendwire-4.polsia.io/), inspeccionada en navegador el 2 de noviembre de 2026.

La URL pertenece a una referencia externa. Los documentos y el desarrollo posterior corresponden a este proyecto local; su despliegue se definirá por separado.

La referencia usa fondo oscuro, acento lima, tipografía clara, bordes discretos y un esquema contrato → impacto → reparación. Su contenido presenta el flujo como ilustrativo y aclara que generar PR requiere una conexión autorizada. Esa distinción debe conservarse mientras las capacidades se implementan. La identidad del área privada debe partir de esta referencia; la landing conserva su estructura pública y el producto tiene navegación propia.

El pulido visual se hará en una etapa posterior con las skills de frontend que correspondan. Al implementarlo se comprobarán las fuentes y los componentes reales; esta revisión no identificó familias tipográficas ni códigos de color exactos.

## Alcance recomendado para el MVP

- Contratos públicos por HTTPS, OpenAPI 3.0 y 3.1 en JSON o YAML. Referencias internas al documento; referencias remotas se identifican como dependencia no soportada inicialmente.
- Repositorios Git públicos por HTTPS para lectura. Generación de PR inicialmente en GitHub, en repositorios seleccionados mediante una GitHub App autorizada.
- Análisis de JavaScript y TypeScript, comenzando con llamadas fetch y Axios cuyo método, ruta y relación con la API puedan demostrarse estáticamente. Otros clientes, rutas dinámicas y lenguajes se indican como cobertura parcial o no soportada.
- Workspace privado de una cuenta, según el requisito actual. La colaboración entre miembros queda como extensión explícita posterior.
- Comparación determinista de contratos. Una propuesta de arreglo utiliza evidencia del contrato y del código; puede emplear un modelo para redactar o proponer un parche, pero la clasificación del cambio no depende de su opinión.
- Creación de PR borrador después de revisar la propuesta y solicitar la acción. El merge queda en el flujo de revisión del repositorio.
- Análisis estático en procesos limitados. Ejecutar scripts, instalar dependencias o correr pruebas de repositorios ajenos requiere un entorno aislado específico; el primer MVP muestra el estado real de la CI existente después de abrir la PR.

Los límites anteriores reducen la incertidumbre de la primera versión. No constituyen una promesa de encontrar todos los usos de una API ni de arreglar cualquier cambio incompatible.

## Ajustes necesarios en los puntos 1 y 2

1. **Separar preparación y ejecución.** En el punto 2 un monitor puede estar guardado, listo o retirado. Estar listo significa que sus fuentes se validaron. El estado de monitoreo habilitado aparece con el punto 3 y muestra última ejecución, resultado y próxima revisión.
2. **Reconocer la autorización de escritura.** Leer un repositorio público no autoriza a publicar ramas ni PR. El monitor conserva utilidad de lectura sin esa conexión y explica cómo habilitar la publicación.
3. **Proteger la descarga de fuentes desde el primer monitor.** Validar DNS y destino de cada conexión, redirección y referencia; rechazar direcciones locales, privadas, link-local y servicios de metadatos. Aplicar límites de tiempo, bytes, archivos y profundidad. Los contratos deben analizarse como datos. No aceptar credenciales en URLs ni ejecutar hooks, submódulos o scripts del repositorio.
4. **Preservar aislamiento.** Cada consulta, acción, trabajo en cola y callback debe asociarse a una cuenta y workspace autorizados en el servidor. El rol admin no concede acceso general al código de clientes.
5. **Configurar datos de confianza del propietario.** El email del propietario y el remitente de recuperación se establecen en configuración privada. No se deducen del texto público de la landing ni de un email reclamado al registrarse.

## Stack recomendado

| Área | Elección propuesta | Motivo |
| --- | --- | --- |
| Aplicación web y servidor del producto | Next.js App Router + TypeScript | Landing, autenticación, workspace y operaciones breves en una aplicación. |
| Interfaz | Tailwind CSS y componentes accesibles de shadcn/ui cuando sean útiles | Traducir la referencia visual y reutilizar componentes del producto. |
| Datos | PostgreSQL + Prisma | Transacciones para permisos, trabajos, suscripciones y consumo; migraciones explícitas. |
| Autenticación | Better Auth con email y contraseña | Registro con acceso inmediato y recuperación por email; configurar explícitamente el comportamiento solicitado. |
| Correo transaccional | Resend | Recuperación, verificación del propietario y avisos; requiere dominio/remitente configurado. |
| Trabajos durables | pg-boss sobre PostgreSQL + worker Node.js separado | Programación, reintentos y procesamiento que sobrevive al cierre de una petición. |
| Contratos | oasdiff, versión fijada y ejecutada por el worker | Reutilizar un motor existente para diferencias y cambios incompatibles. |
| Análisis del código | TypeScript Compiler API mediante ts-morph | Obtener evidencia estructural y aplicar transformaciones acotadas. |
| Integración con repositorios | GitHub App | Permisos por instalación y repositorios elegidos; tokens de corta duración. |
| Propuestas asistidas | Adaptador para un proveedor de modelos | Elegir modelo con una evaluación de calidad, costo y tratamiento del código antes de habilitarlo. |
| Cobros | Paddle como candidato para suscripciones internacionales | Confirmar elegibilidad de la entidad, país de operación, alta y condiciones antes de integrar cobros reales. |
| Despliegue inicial | Railway: aplicación web, worker y PostgreSQL como servicios separados | Recomendación operativa para alojar la aplicación y sus trabajos en un mismo proyecto. |
| Verificación futura | Vitest para lógica y Playwright para recorridos de navegador | Cubrir comparaciones, permisos, consumo y el recorrido del usuario. |

Esta es una recomendación de arquitectura. No fija versiones, precios ni cuentas contratadas. Las versiones compatibles se seleccionarán y fijarán durante la preparación técnica.

### Flujo de trabajo

Next.js autentica, valida permisos y registra la solicitud junto con un trabajo durable. El worker recupera el contrato, conserva la versión, ejecuta oasdiff y obtiene una revisión inmutable del repositorio. El análisis guarda evidencias referidas a ese commit. La propuesta se revisa en el workspace; publicar una PR revalida permisos, versión del código y acceso disponible.

PostgreSQL conserva usuarios, workspace, monitores, versiones de contrato, ejecuciones, hallazgos, evidencias, propuestas, referencias a PR, eventos de facturación y registros de consumo. Los repositorios se procesan temporalmente con límites y limpieza; no se guardan copias completas de forma indefinida.

Las funciones web y el worker comparten reglas de autorización y acceso, con comprobación independiente en cada entrada. Los trabajos que produzcan efectos externos usan claves de idempotencia. El worker vuelve a comprobar retiro del monitor, revocación de permisos y acceso del plan antes de ejecutar la acción.

## Orden recomendado de construcción

La numeración comercial del roadmap puede conservarse. El orden técnico debe seguir estas dependencias:

1. Punto 1: acceso del cliente, workspace y cuenta; acceso seguro del propietario.
2. Punto 2: monitores y validación segura de fuentes. Incorporar 5.1 para acompañar al primer usuario.
3. Tarea 6.1: definir acceso y presupuestos de la beta antes de habilitar trabajos costosos.
4. Tareas 3.1 y 3.2: primer contrato, comparación e impacto real. La conexión GitHub 3.3 puede desarrollarse en paralelo después del punto 2.
5. Tareas 3.4 y 3.5: propuesta revisable y PR borrador. Incorporar 3.6 y 5.2 para que el resultado llegue al usuario.
6. Tareas 6.2 y 6.3: imponer consumo y cambios de acceso antes de abrir una beta amplia o vender acceso.
7. Tareas 4.1, 4.2 y 4.3: compra, confirmación confiable y autogestión de suscripción. Su desarrollo puede avanzar en sandbox mientras se completa el producto; cobros reales requieren los controles anteriores.

La definición de planes en 6.1 es compartida por facturación y permisos. El punto 4 convierte una compra confirmada en acceso; el punto 6 aplica capacidades y límites en cada operación. Esa separación evita duplicar reglas.

## Verificaciones por etapa

- Después de los puntos 1 y 2: una cuenta nueva crea su workspace y monitor, lo reabre tras refrescar y otra cuenta no puede acceder cambiando identificadores. Recuperación, cierre de sesión y verificación del propietario funcionan.
- Después de 3.1 y 3.2: dos versiones controladas producen el cambio esperado y evidencias sobre un commit conocido; una fuente caída nunca aparece como revisión exitosa ni reemplaza la versión válida anterior.
- Después de 3.3 a 3.6: un repositorio de prueba autorizado recibe una sola PR borrador por solicitud; revocar la instalación impide nuevas escrituras y los avisos no se duplican al reintentar.
- Antes de cobros reales: probar compra y renovación en sandbox, eventos repetidos o desordenados, consumo concurrente en el límite y pérdida de acceso durante trabajos pendientes. Cada caso debe producir una política y un estado visibles.

Los comandos exactos se incorporarán cuando exista el proyecto y sus scripts. Este documento no presenta verificaciones de implementación como ejecutadas.

## Qué agregaría al roadmap

### Validación comercial paralela

La investigación aportada demuestra que existen herramientas relacionadas. La disposición a pagar por reparar integraciones sigue siendo una hipótesis. Como experimento propuesto: conversar con cinco equipos que mantengan APIs ajenas, revisar un incidente real reciente y conseguir dos pilotos con permiso sobre repositorios concretos. Registrar tiempo de diagnóstico actual, evidencia que consideran suficiente y si aceptarían revisar una PR propuesta. El objetivo es orientar alcance y oferta; esos números son metas del experimento, no demanda demostrada.

### Colaboración después del primer flujo completo

La misión habla de equipos y el acceso inicial es individual. Después de demostrar el recorrido principal, añadir una etapa para invitaciones y roles de owner/member, transferencia de propiedad y permisos por workspace. El esquema debe permitir esa evolución, sin habilitar acceso por compartir un dominio de email.

### Operación y confianza para la beta

Antes de admitir repositorios de clientes, registrar las políticas de retención y borrado, tratamiento del código por proveedores de modelos y desconexión de GitHub. Para la beta operativa: backups con restauración comprobada, alertas de trabajos fallidos y un recorrido que explique el estado de una ejecución y permita recuperarla. Son condiciones del servicio que maneja código, no una nueva pantalla administrativa de negocio.

### Expansión posterior

Fuentes privadas con almacenamiento seguro de secretos, otros proveedores Git, más lenguajes y clientes HTTP, colaboración avanzada y ejecución de pruebas en sandboxes son incrementos separados. El primer MVP no debe presentarlos como capacidades disponibles.

## Decisiones pendientes y cómo resolverlas

| Decisión | Propuesta para avanzar | Evidencia para cerrarla |
| --- | --- | --- |
| Subsegmento inicial | Equipos que mantengan integraciones JS/TS con contratos accesibles | Incidentes y repositorios de los pilotos. |
| Casos reparables | Transformaciones demostrables en fetch/Axios | Corpus de cambios con resultado esperado y revisión humana. |
| Modelo y proveedor | Mantener una interfaz pequeña | Evaluación de calidad, política de datos, latencia y presupuesto por propuesta. |
| Oferta y cuotas | Una oferta inicial y beta acotada | Costos medidos por análisis y aprendizaje de los pilotos; sin precios inventados. |
| Cobros | Evaluar Paddle primero | Alta aprobada y posibilidad real de operar y recibir fondos con la entidad elegida. |
| Retención y eliminación | Guardar lo mínimo necesario para explicar el hallazgo | Necesidades de auditoría y privacidad de los pilotos. |

## Fuentes técnicas consultadas

Estas fuentes sustentan capacidades concretas de las herramientas, no el ajuste comercial de Mendwire. Consulta: 2 de noviembre de 2026.

- [Better Auth: email y contraseña](https://better-auth.com/docs/authentication/email-password): autenticación, verificación opcional y recuperación.
- [pg-boss](https://pgboss.io/): trabajos en PostgreSQL, programación y reintentos.
- [oasdiff: motor y soporte OpenAPI](https://github.com/oasdiff/oasdiff): comparación y detección de cambios incompatibles.
- [ts-morph](https://ts-morph.com/): envoltorio del compilador de TypeScript para analizar y modificar su árbol sintáctico.
- [GitHub: permisos de una GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app): permisos mínimos y autorización por instalación.
- [Paddle: eventos de facturación](https://developer.paddle.com/webhooks/): eventos para sincronizar compra, suscripción y acceso.
- [Paddle: cobertura y restricciones](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle): comprobar el caso de la entidad antes de cerrar el proveedor.
- [Railway: Next.js y PostgreSQL](https://railway.com/guides/nextjs): despliegue de la aplicación y conexión con la base de datos.
