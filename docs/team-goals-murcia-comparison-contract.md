# Contrato de comparación Murcia → Alicante

ATLAS Alicante no accede directamente a pacientes, cobros ni facturas del proyecto de Murcia. La comparación consume únicamente un resumen mensual agregado que un proceso autorizado deposita en la configuración de Alicante.

## Destino

- Proyecto: ATLAS CRM (Alicante).
- Tabla: `public.clinic_settings`.
- Clínica: FisioSport Alicante.
- `section`: `other` (registro ya existente de Alicante).
- Ruta dentro de `payload`: `team_goals_murcia_comparison`.

## Formato de `payload.team_goals_murcia_comparison`

```json
{
  "period": "2026-11",
  "generated_at": "2026-11-30T22:00:00Z",
  "source": "atlas-murcia",
  "clinics": {
    "murcia": {
      "metrics": {
        "team_net_invoicing": { "actual": 0, "target": 0, "percentage": null, "active": true },
        "team_traction_paid_sessions": { "actual": 0, "target": 0, "percentage": null, "active": false },
        "team_mbst_paid_sessions": { "actual": 0, "target": 0, "percentage": null, "active": true },
        "team_bomba_paid_sessions": { "actual": 0, "target": 0, "percentage": null, "active": true },
        "team_brains_paid_sessions": { "actual": 0, "target": 0, "percentage": null, "active": true }
      }
    }
  }
}
```

Murcia puede publicar Robot en `team_traction_paid_sessions` para ocupar la tercera fila comparable definida por dirección: Robot en Murcia frente a Tracción en Alicante. El panel muestra únicamente totales y porcentajes; el resumen no debe incluir pacientes, profesionales, citas, presupuestos ni documentos fiscales.

## Reglas

- El proceso de Murcia solo escribe el resumen agregado autorizado.
- La aplicación de Alicante nunca escribe en el proyecto de Murcia.
- Un resumen de otro mes se considera no disponible.
- Barcelona permanece pendiente hasta disponer de un ATLAS operativo y un contrato equivalente.
