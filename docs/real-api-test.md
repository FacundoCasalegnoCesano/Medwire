# Probar el API existente de historial de checks

La prueba usa el endpoint existente y de solo lectura `GET /api/monitors/{id}/checks`, llamado desde [`src/components/monitor-check-panel.tsx`](../src/components/monitor-check-panel.tsx). El contrato enfocado [`docs/contracts/check-history.openapi.json`](contracts/check-history.openapi.json) describe autenticación por sesión, cursor opcional, respuesta de página y errores conocidos. No pretende describir el resto del API de Medwire.

## Probar el endpoint local

1. Iniciá Medwire con su configuración local existente. La base PostgreSQL local debe estar disponible como de costumbre; esta prueba no modifica su esquema ni requiere migraciones. Abrí dos terminales PowerShell con la misma configuración local:

   ```powershell
   npm run dev
   ```

   En la segunda, iniciá el worker que procesa los checks y análisis:

   ```powershell
   npm run worker:monitoring
   ```

2. Iniciá sesión en [http://127.0.0.1:3000/sign-in](http://127.0.0.1:3000/sign-in) y abrí [http://127.0.0.1:3000/app/monitors](http://127.0.0.1:3000/app/monitors).

3. Abrí un monitor existente y copiá su ID de la URL del monitor. En la misma sesión del navegador, visitá `http://127.0.0.1:3000/api/monitors/<monitor-id>/checks`, reemplazando `<monitor-id>` por ese ID. La respuesta JSON debe incluir `runs`, `nextCursor` y `hasMore`. Sin sesión devuelve 401. Un cursor inválido devuelve 400; un monitor no disponible para tu espacio devuelve 404. La consulta no inicia un check.

## Ejecutar la prueba reproducible del cambio

El CLI no necesita que la app ni PostgreSQL estén en ejecución. Compara el fixture inmutable [`check-history.baseline.openapi.json`](contracts/check-history.baseline.openapi.json), que conserva el contrato base anterior a la retirada del `GET`, con una copia en memoria que elimina esa operación. Luego corre oasdiff 1.35.0 y el analizador sobre el componente consumidor guardado en un commit de Git. El fixture no sigue los cambios del contrato publicado:

```powershell
# Solo si falta el binario local .tools/oasdiff-1.35.0:
npm run install:oasdiff
npm run demo:verify:checks
```

Se espera un hallazgo de eliminación en oasdiff y evidencia `CANDIDATE` del analizador. El componente arma una URL relativa con el ID dinámico del monitor, así que el analizador no puede probar la ruta exacta y no debe elevarla a `CONFIRMED`. El reporte limita la cobertura a ese componente y marca el resultado `LOCAL_ONLY`. Esta simulación no cambia el endpoint ni activa el botón de Analyze impact en la interfaz.

## Probar un monitor con el contrato publicado

El contrato de la rama `Desarrollo` ya está publicado. El raw URL y el repositorio son:

- **OpenAPI contract URL:** `https://raw.githubusercontent.com/FacundoCasalegnoCesano/Medwire/Desarrollo/docs/contracts/check-history.openapi.json`
- **Git repository URL:** `https://github.com/FacundoCasalegnoCesano/Medwire`

La URL raw está publicada y fue verificada como legible. En el análisis breaking exitoso del usuario, fijado al commit `cafb211b040fbabe87a06cf9d62863c6ff67ce0c`, se analizaron 30 de 101 archivos y apareció un candidato de descarga ajeno al endpoint. Este resultado motivó los cambios de selección y confianza documentados en `tasks/egm/2026-11-06_CONSUMER_SELECTION.md`; no prueba cobertura completa ni constituye una verificación independiente de esta revisión. La rama default `master` ya contiene el consumidor real; el resolver de impacto toma allí el SHA y la versión del componente. Ese SHA puede diferir del usado por el CLI local, que lee el componente desde el `HEAD` actual de `Desarrollo`.

El contrato publicado actualmente ya retira el `GET`. Para que un monitor nuevo observe una transición breaking, primero restaurá el contrato base con el `GET` en ese mismo archivo de `Desarrollo` y hacé push. Ejecutá un check exitoso para guardar el baseline; luego volvé a retirar el `GET`, hacé push y ejecutá otro check después del cooldown. Conservá exactamente la misma URL raw en ambas revisiones. La primera revisión guarda el baseline; la segunda debe producir `CHANGES_FOUND` y un finding `BREAKING`. Cambiar la URL del contrato crea otra fuente y reinicia el baseline. `demo:verify:checks` simula esta retirada localmente; no publica la revisión breaking ni ejecuta el monitor.

Un análisis exitoso ya guardado conserva su resultado cuando se repite la misma solicitud. Para probar el analizador v4, generá un nuevo check breaking después de publicar esas dos revisiones; no se vuelve a analizar un check exitoso anterior. Reiniciá el proceso web y el worker para cargar el código nuevo.

El botón **Analyze impact** solo aparece cuando un check alcanza `SUCCESS`, `CHANGES_FOUND` y al menos un finding `BREAKING`. Guardar baseline o recibir `UNCHANGED` no habilita el análisis. El límite local por defecto entre checks manuales es de 300 segundos; esperá el cooldown indicado por la interfaz antes de solicitar otro check. No hace falta ni corresponde saltear ese límite.
