# Investigación de UI para Mendwire

**Fecha:** 3 de noviembre de 2026\
**Estado:** síntesis documental. No es una dirección visual aprobada ni un cambio implementado.\
**Informes de detalle:** [21st.dev](./21st.md), [Cult UI y Animata](./cult-animata.md), [React Bits y HeroUI](./reactbits-heroui.md).

## Conclusión

La opción más consistente es evaluar **HeroUI OSS v3 como base funcional**, y sumar componentes originales puntuales de Cult UI, Animata, React Bits o
21st.dev donde añadan valor visible. No hace falta adoptar el look completo de ninguna biblioteca. HeroUI encaja con React 19 y Tailwind 4; publica
controles con documentación de teclado/estados y licencia Apache-2.0. Cult aporta código/terminal para el lenguaje de programación. Las otras
bibliotecas ofrecen detalles, con límites distintos de licencia y movimiento.

El rediseño debe cambiar la composición completa: cabecera, navegación, jerarquía y densidad, además de mostrar el producto como una herramienta de
ingeniería. Un fondo animado aislado no resuelve lo que hoy no convence. Cualquier dirección visual abajo es una recomendación para evaluar, no una
decisión confirmada por el usuario.

## Cinco fuentes comparadas

| Sitio | Qué se obtiene gratis y licencia | Qué se paga por separado / límites | Prioridad |
|---|---|---|---|
| [HeroUI OSS v3](https://heroui.com/en/docs/react/getting-started/quick-start) | 75+ componentes React con ejemplos, source y style source. Repo v3 bajo [Apache-2.0](https://github.com/heroui-inc/heroui/blob/v3/LICENSE); compatible con uso comercial bajo sus condiciones. | HeroUI Pro vende componentes, bloques, themes, templates y tooling aparte. El precio actual no quedó visible en la consulta. Pro v2 es producto/licencia distinta. Preview no equivale a source gratis. | **Base recomendada** para controles y comportamiento accesible; evaluar antes de añadir globalmente sus estilos y dos paquetes (`@heroui/react`, `@heroui/styles`). |
| [Cult UI](https://www.cult-ui.com/docs/components) | Biblioteca OSS pública con [MIT](https://github.com/nolly-studio/cult-ui/blob/main/LICENSE.md). Las piezas públicas incluyen source/registry; 58 componentes antes de Pro se publicaron bajo MIT. | AI SDK Agents y servicios externos son productos aparte. Los bloques, plantillas y descargas antiguos de Cult Pro no se vuelven MIT por el retiro de la oferta. | **Alta** para panel de código, terminal ilustrativa y pequeños controles técnicos; no usar como sistema visual completo. |
| [Animata](https://animata.design/components) | 157+ componentes públicos, con source/registry y [MIT](https://github.com/codse/animata/blob/main/LICENSE.md). Se copian archivos a la app; no exige paquete runtime de Animata. | No se encontró nivel premium necesario para las piezas revisadas. Licencias de imágenes/marcas de terceros se revisan por separado. | **Media** para un skeleton o detalle puntual; gran parte del catálogo son demos genéricas animadas. |
| [React Bits](https://reactbits.dev/get-started/installation) | Catálogo gratis con demos, source e instalación. Repo [MIT + Commons Clause](https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md): permite uso comercial dentro del producto, no vender o redistribuir la pieza como UI kit, librería, paquete o template. | React Bits Pro es aparte: Starter US$129, Pro US$249 y Ultimate US$349, pago único según páginas revisadas. La plantilla Portfolio dice uso gratis personal/comercial, pero **su acceso a source/descarga no se confirmó**. No confundir con páginas/elementos Pro ni con Animated List gratuito. | **Media-baja** para uno o dos acentos. No usar como base ni extraer código de previews Pro. |
| [21st.dev](https://21st.dev/community/components) | Explorar/buscar/previsualizar gratis. Hay 2 copias/instalaciones diarias con cuenta; la cuota no afecta los registries públicos del autor. Cuatro piezas revisadas tienen source original directo, sin login, y MIT: [Code Block](https://iconiqui.com/r/code-block.json), [Terminal](https://magicui.design/r/terminal.json), [Terminal Typewriter](https://ui.beste.co/r/terminal1.json), [Auth Form](https://smoothui.dev/r/auth-form.json). Cada item del marketplace necesita su propia licencia; no inferir MIT para toda la comunidad. | Builder elimina el límite de copies; AI requiere créditos y comienza en US$15/mes con facturación anual según la página consultada. Plantillas de autor pueden venderse por separado. Los términos protegen demos/media; conservar atribución/enlace visible cuando corresponda. | **Selectiva** para piezas fuente confirmadas; usar registry del autor evita cuota. No tratar toda la comunidad como código libre. |

Fuentes de precio/cuota: [planes y cuota 21st](https://21st.dev/plans), [membership](https://docs.21st.dev/blog/introducing-21st-membership),
[términos 21st](https://docs.21st.dev/terms), [licencia y Pro de React Bits](https://pro.reactbits.dev/license), [términos de Cult
Pro](https://www.pro.cult-ui.com/terms). Los precios y conteos pueden cambiar. El precio actual de HeroUI Pro no se confirmó.

## Shortlist coherente

Estos diez candidatos son piezas originales para adaptar, con dos alternativas para el bloque de código. La lista no propone reconstruirlos desde capturas ni incluir código premium. HeroUI
conforma los controles comunes; las otras piezas son detalles opcionales. Para paneles de código, **elegir Cult Code Block o 21st Code Block**; no
hace falta sumar los dos.

| Componente y fuente | Superficie / propósito | Dependencias y costo observado | Límite antes de adoptar |
|---|---|---|---|
| [HeroUI Button](https://heroui.com/en/docs/react/components/button) | Landing, acceso y workspace: acciones consistentes | `@heroui/react`; documenta variantes, pending/disabled y foco. El paquete aún no está instalado. | Mapear tokens a la nueva dirección; medir bundle y validar estilo global después de una prueba acotada. |
| [HeroUI TextField](https://heroui.com/en/docs/react/components/text-field) | Acceso y creación/edición: label, descripción y error junto al campo | `@heroui/react`; composición con soporte React Aria y FieldError. | Mantener los handlers, errores y contratos actuales; revisar autofill, zoom y lector de pantalla. |
| [HeroUI Table](https://heroui.com/en/docs/react/components/table) | Workspace: lista de monitores si la cantidad justifica filas/columnas | `@heroui/react`; TanStack es opcional en ejemplo dedicado, no requisito general. | Puede exceder la necesidad CRUD actual. Comprobar ancho móvil, scroll, selección y `aria` con datos reales. |
| [HeroUI Toast](https://heroui.com/en/docs/react/components/toast) | Workspace: confirmación breve después de guardar/retirar | `@heroui/react`; requiere provider de notificaciones. | No reemplazar mensajes persistentes ni errores inline. Probar anuncio aria-live y duración. |
| [Cult Code Block](https://www.cult-ui.com/docs/components/code-block) · [registry](https://www.cult-ui.com/r/code-block.json) | Landing: ejemplo de contrato/código con archivo y pestañas | React, shadcn, Tailwind 4; source completo confirmado, deps `motion` y `lucide-react`; ya existen. Registry añade sus deps declaradas. | Mantenerlo explícitamente ilustrativo. La ficha indica teclado, ARIA, tema oscuro y tabs móviles; revisar el mapeo de tokens antes de adoptar. Syntax highlighting no confirmado. |
| [21st Code Block — @iconiq](https://21st.dev/@edwinvakayil/components/code-block) · [registry](https://iconiqui.com/r/code-block.json) | Alternativa de landing para archivo, líneas, copy y etiqueta de lenguaje | Archivo `code-block.tsx` verificado; `motion` y `lucide-react` ya presentes. MIT en ficha. | Demo clara; adaptar a paleta y contraste propios. Link/atribución visible según términos 21st. No usar como resultado de análisis real. |
| [Cult Halo Badge](https://www.cult-ui.com/docs/components/halo-badge) · [registry](https://www.cult-ui.com/r/halo-badge.json) | Workspace: “Draft”, “Sources ready” o “Withdrawn” junto con texto | `motion` ya existe; source completo confirma además `class-variance-authority` y componente badge requerido por el registro. | Preferir estado sin pulso salvo transición real; la ficha declara reduced-motion. Color no debe ser la única señal. |
| [Animata Code Skeleton](https://animata.design/docs/skeleton/code) · [registry](https://animata.design/r/skeleton/code.json) | Workspace/landing: solo durante carga real de contenido | Importa `CodeIcon` de `lucide-react`, ya disponible; no Motion ni canvas en source observado. | Aplicar forma fluida, usar `aria-busy`/anuncio real. No emplear como decoración ni estado vacío. |
| [React Bits Spotlight Card](https://reactbits.dev/components/spotlight-card) | Landing: acento localizado en el ejemplo del producto | Source inspeccionado usa React/CSS, `requestAnimationFrame`, gradientes, `IntersectionObserver` y eventos de puntero; no canvas/WebGL ni dependencia externa observada. | MIT + Commons Clause permite uso dentro del producto; no redistribuir como kit. Respeta reduced-motion y foco según source visible. Sin benchmark. |
| [Magic UI Terminal](https://21st.dev/@dillionverma/components/terminal) · [registry/source](https://magicui.design/r/terminal.json) | Landing: narrar pasos verificables de una validación como ejemplo | Source público `registry/magicui/terminal.tsx`; `motion` ya está instalado; MIT del repo Magic UI. | Terminal animado simula comandos, no ejecuta shell ni comprobaciones. Usar una secuencia estática con reduced motion y etiquetar el ejemplo. |

**Detalles que descartaría por ahora:** Terminal Typewriter de Beste es source MIT confirmado, pero duplica el propósito de Magic UI Terminal y añade
`clsx`/`tailwind-merge`/`lucide-react` ya existentes. Animata Fluid Tabs no debe usarse para rutas: solo para alternar contenido del mismo contexto y
requiere revisar movimiento reducido. React Bits Code Slots/Stepper implican OTP o un flujo de varios pasos que el producto no tiene. Data Grid con
drag/resizing agrega complejidad sin justificarla para pocos monitores.

## Dos direcciones visuales posibles

1. **Mesa de trabajo tipo editor — recomendada para explorar.** Diseñar el conjunto como una aplicación de ingeniería: cabecera y nav persistentes,
contenido principal con título/acción, editor de ejemplo con tabs de OpenAPI y repositorio en landing, formulario de acceso simple y workspace con
lista/detalle de monitores. Usar borde, grilla, tipografía mono para datos y una única señal de estado. Código y terminal son componentes reales
instalados desde sus fuentes y adaptados a datos/copy veraces. Evitar panels que solo aparecen por hover y fondos que tapan la composición.
2. **Papel técnico con consola insertada.** Mantener lectura editorial para páginas públicas, pero rehacer la cabecera, jerarquía y composición;
anclar al hero un bloque de producto en forma de editor estático. Acceso comparte reglas, tipografía y controles. Workspace pasa a estructura de
aplicación más densa, con lista de monitores y detalle visible. El contraste papel/consola daría identidad sin convertir toda la interfaz en una
plantilla de dashboard.

Las dos direcciones requieren revisar composición completa, no solo intercambiar background. Deben preservar marca Mendwire, límites del producto,
foco visible, uso por teclado, móvil y reduced-motion descritos en [PRODUCT.md](../../PRODUCT.md) y compararse con [DESIGN.md](../../DESIGN.md), que
es antecedente y no identidad obligatoria.

## Costos y verificación

**Dependencias observadas:** `motion`, `lucide-react`, `clsx` y `tailwind-merge` ya figuran en Medwire. HeroUI requiere `@heroui/react` y
`@heroui/styles`; el tamaño final no se midió. Cult Code Block tiene fuente completa y deps Motion/Lucide; Halo Badge añade `class-variance-authority`
y el componente badge requerido por el registro. Animata se copia por archivo, pero sus registries declaran Lucide 0.475 y Motion 12.38, versiones anteriores a las del
proyecto: mantener las versiones actuales y comprobar compatibilidad al integrar. React Bits Spotlight Card usa `requestAnimationFrame`, gradientes
CSS e IntersectionObserver; no usa WebGL ni dependencia externa observada. 21st Terminal y Code Block usan Motion. No se midieron CPU/GPU, bundle ni
rendimiento móvil.

**Rendimiento y accesibilidad:** evitar shaders/WebGL, loops y múltiples animaciones en el workspace. Mostrar datos/errores como texto, permitir
estados estáticos y comprobar foco, teclado, ARIA y 390px al integrar. Una demo pública o una ficha que declara “accessible” no prueba funcionamiento
dentro de Mendwire.

La investigación fue documental y de previews públicas. **No se instaló ninguna dependencia ni se ejecutó el runtime de Mendwire**, por lo que
compatibilidad, bundle y rendimiento siguen pendientes. Tampoco se inspeccionó la fuente de Portfolio Pro: el permiso de uso anunciado no confirma
acceso a descarga/source.

## Recomendación concreta

Explorar primero un prototipo de la **Mesa de trabajo tipo editor** usando HeroUI OSS v3 solo para Button/TextField y una lista de monitores; sumar un
componente de código original (Cult Code Block o @iconiq Code Block), sin terminal animado hasta que el ejemplo y el reduced-motion estén resueltos.
Mantener React Bits y Animata como opciones de detalle, no como fundamento. Este orden reduce dependencias nuevas y permite juzgar si la composición
completa mejora lo que hoy no gusta antes de rehacer todas las páginas.

El próximo paso genuino es revisar contigo esa dirección visual recomendada y su alcance de pantallas. Ninguna dirección ni componente está aprobado o
implementado todavía.


## Pendientes reales

- Elegir con el usuario si vale explorar la mesa de trabajo tipo editor antes de rediseñar las pantallas.
- Si se aprueba, revisar los imports y tokens de los componentes elegidos contra las versiones instaladas, sin aceptar downgrades automáticos de Animata.
- Probar integración y accesibilidad dentro de Medwire: escritorio, 390px, foco/teclado y reduced-motion. Esta investigación no valida esos flujos.
- Medir bundle y efectos con profiler solo después de escoger piezas; hasta ahora son dependencias y cargas observadas en fuente/demo, no benchmark.
- No reutilizar la descarga de Portfolio Pro mientras el source no esté confirmado; no acceder a bloques/templates premium ni copiar previews como implementación.
