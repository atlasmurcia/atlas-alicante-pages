# Recordatorios de fichaje por chat · Alicante

Los avisos se generan en el servidor, sin depender de una pestaña abierta. La entrega visible requiere abrir ATLAS con conexión. No generan fichajes.

- Solo se habilitan las dos cuentas clínicas identificadas y autorizadas. La tercera persona queda pendiente de identificar; no se deduce otra identidad.
- `private.atlas_clock_reminder_targets` selecciona destinatarios, sin copiar sus horarios.
- El cálculo consulta `company.professionals[].schedule`, `agenda.availabilityOverrides`, horario y cierres del centro, bloqueos de jornada, ausencias de Control asistencial y ausencias aprobadas del módulo de personal. Las reuniones y la formación no se convierten en salidas/entradas. Los avisos antiguos convertidos desde citas no se interpretan como ausencias.
- Cada extremo de cada tramo efectivo genera un aviso con `due_at = event_at - 3 minutos`, en Europe/Madrid. Intervalos adyacentes se unen. Los horarios vacíos o inválidos no generan avisos.
- Se recalcula cada minuto; una clave única evita duplicados. Un cambio de jornada retira avisos pendientes de hoy/futuros que ya no corresponden; conserva el mensaje como historial. No se generan avisos retrospectivos a la activación.
- Los mensajes aparecen en la conversación virtual **ATLAS Fichajes** y en un aviso persistente. Abrir el chat no los confirma. Solo OK confirma lectura en el servidor; no registra entradas ni salidas. Si falla OK, permanece el aviso. Los mensajes confirmados siguen la retención visible de siete días del chat; un aviso sin confirmar permanece pendiente.
- La tabla nueva permite leer solo mensajes propios de una cuenta activa y actualizar únicamente su confirmación. El cliente no puede crear avisos ni modificar su texto, horario o destinatario. El generador privado no es ejecutable por cuentas de aplicación.

## Publicación y activación

La migración instala la tarea desactivada. Los destinatarios se registran únicamente en la configuración privada, sin sus datos identificativos en el repositorio. Publicar primero `shell/clock-reminders.js`, el chat y `index.html`. Después, con la autorización de publicación existente, activar **solo las dos filas identificadas** y `cron.job` llamado `atlas-clock-chat-reminders`, fijando `enabled_at` al instante de activación. No tocar los horarios ni las tablas de fichajes.

Para detener envíos futuros, desactivar ese único trabajo y los destinatarios de esta función. No borrar registros anteriores. Las confirmaciones ya guardadas permanecen.

## Comprobaciones

- `tests/clock-reminders-database.cjs` ejecuta la migración en Postgres local PGlite 0.3.14 con organizaciones, cuentas y horarios ficticios. Comprueba tramos partidos, continuos, cambios puntuales, festivos, ausencias, cierres, reuniones, invierno/verano, idempotencia del generador y aislamiento de lectura/OK. Configurar `ATLAS_PGLITE_MODULE` si el módulo está instalado fuera del repositorio.
- `tests/clock-reminders-ui.cjs` usa jsdom 26.1.0 y los scripts reales del chat para comprobar persistencia, fallo/reintento, recarga, cancelación y cambio de cuenta. Configurar `ATLAS_JSDOM_MODULE` si procede.
- En producción comprobar únicamente estado del trabajo, destinatarios activados, esquema/permisos y recuentos del generador. No insertar mensajes ficticios en chats reales ni modificar fichajes para probar.
