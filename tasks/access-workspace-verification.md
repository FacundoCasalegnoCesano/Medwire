# Verificación del acceso y workspace

La validación local terminó con `npm run lint`, `npm run typecheck` y `npm test` aprobados; la suite unitaria pasó 5 de 5 pruebas. `scripts/test-auth-integration.ps1` pasó 1 de 1 prueba sobre PostgreSQL local `mendwire_test`, cubriendo registro inmediato, aislamiento entre dos cuentas, cierre e inicio de sesión, recuperación con enlace de uso único y vencimiento, revocación de sesiones y bloqueo de callback externo.

`npm run build` terminó con código 0 y generó nueve rutas. La aplicación local respondió en `127.0.0.1:3000`. En navegador se comprobó registro con una cuenta descartable, actualización, nuevo inicio de sesión, protección del workspace tras cerrar sesión, navegación con Tab/Enter, página de Account y vista móvil de 390 × 844 sin desbordamiento. La consola no registró errores. La cuenta descartable quedó eliminada y se confirmó su ausencia.

La fuente Inter Variable se carga localmente. `npm audit --omit=dev` reportó cero vulnerabilidades. El setup creó `mendwire` y `mendwire_test` sin tocar otras bases; la contraseña administrativa se limpió del archivo local y no se incluyeron secretos ni URLs con contraseña en esta evidencia. La inspección elevada confirmó cero procesos Docker y el servicio Docker detenido.

El alcance actual permite el acceso de clientes a un workspace individual por cuenta. La administración del propietario y Monitores quedan para próximos bloques. Vitest mostró un aviso informativo de cargador de configuración futura; no afectó las pruebas.
