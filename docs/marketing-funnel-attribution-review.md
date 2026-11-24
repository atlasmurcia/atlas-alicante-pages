# Propuesta de embudo por campaña (ATLAS Alicante v235)

**Estado:** propuesta para revisión técnica; no aplicada a Supabase ni publicada.  
**Base:** [v235, 23-11-2026](https://github.com/atlasmurcia/atlas-alicante-pages/commit/de509cbaa7cc4d15a17e587bc088b56b798677d3).

## Resultado que se quiere mostrar

Una fila por campaña y periodo de entrada del lead, con conteos de personas sin duplicar y tasas sobre la etapa anterior:

1. Leads recibidos.
2. Leads con valoración realizada.
3. Leads con primera consulta realizada.
4. Leads que iniciaron tratamiento: al menos una cita terapéutica realizada después de la primera consulta.
5. Leads con presupuesto presentado.
6. Leads con presupuesto aceptado.

Valoración y primera consulta son ramas de conversión distintas que nacen de los leads; no se suman entre sí. Aceptación de presupuesto se informa separada del inicio efectivo de tratamiento. El panel será agregado y no mostrará nombres ni datos de contacto.

## Regla de fechas y campañas

- La campaña y fecha de cohorte son las guardadas en el lead cuando entró.
- La actividad posterior se atribuye a esa campaña solo cuando existe relación inequívoca con el lead.
- Cada persona cuenta una vez por etapa y campaña. Si una persona tiene más de un lead activo o de campañas distintas y no existe un vínculo explícito, queda como «sin atribución confirmada».
- La actividad se considera realizada solo con cita en estado completado. Citas anuladas, futuras, llamadas y bloques administrativos no cuentan como asistencia.
- Un presupuesto presentado significa estado «entregado» o «aceptado»; un borrador no cuenta. Aceptación se mide por `accepted_at`. Los cobros se podrán añadir como medida aparte en otra fase, sin equipararlos a aceptación.

## Qué registra hoy el sistema

La función actual devuelve visitas agregadas como un único total; no distingue valoración de primera consulta. El vínculo de cita a lead solo existe en una pequeña fracción de las citas y los presupuestos no tienen vínculo directo a lead ni a cita. En consecuencia, no se debe presentar el cruce retrospectivo por paciente y fecha como atribución exacta.

## Propuesta de registro

Revisar y aprobar antes de aplicar:

- Añadir `lead_id` opcional a citas y presupuestos con clave foránea compuesta que impida enlazar datos de otra clínica u organización.
- Añadir `presented_at` al presupuesto. Fijarlo al pasar por primera vez de borrador a entregado; si se acepta directamente, usar la fecha de aceptación como fecha de presentación.
- Al reservar desde FlowAtlas, guardar el `lead_id` en la cita.
- Al crear un presupuesto desde una ficha vinculada a un lead, conservar ese `lead_id`. Si hay varias campañas posibles, pedir selección explícita; si no hay relación clara, dejarlo sin atribución.
- Para contar inicio de tratamiento, clasificar servicios con una lista revisada por la clínica. No inferirlo de cualquier cita completada ni de la aceptación del presupuesto.
- Exponer al panel solo los agregados y totales de calidad de atribución; mantener la comprobación de acceso de Gestión y el aislamiento por clínica.

## Tratamiento del histórico

- No modificar ni rellenar relaciones históricas automáticamente en esta fase.
- Mostrar conteos confirmados por vínculo directo y, en una banda aparte, los casos históricos sin atribución confirmada.
- Un cruce histórico por ficha/fecha puede servir como estimación de auditoría, con etiqueta «estimado», nunca mezclado con el total confirmado.

## Revisión necesaria antes de implementación

1. Responsable técnico: validar columnas, claves foráneas, escritura desde la reserva y guardado del presupuesto, y el cálculo de cada etapa.
2. Responsable de seguridad: revisar aislamiento organización/clínica, RLS y que la función agregada no revele datos personales.
3. Clínica: aprobar la lista de servicios que cuentan como valoración, primera consulta y tratamiento iniciado.
4. Después de aprobar, aplicar en entorno de pruebas sintéticas, verificar casos de duplicados, anulaciones, leads sin paciente enlazado y varias campañas; y solo entonces considerar producción.

## Límites de esta propuesta

No contiene datos de pacientes, cambios de producción, cambios de permisos/RLS, ni una publicación. No se ejecutaron pruebas en producción.
