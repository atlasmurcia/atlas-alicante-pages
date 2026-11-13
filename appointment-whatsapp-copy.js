(function (root) {
  const firstVisit = `Hola [CLIENTE], gracias por pedir tu cita en Fisiosport Alicante.
🗓️El día [FECHA] a las [HORA]

Su bienestar es nuestra prioridad. Le rogamos puntualidad para aprovechar al máximo su sesión

C. Sacerdote Isidro Albert, 20, local 5, 03010 Alicante

https://maps.app.goo.gl/HnSAphRy6qdQMdFw6

APARCA RÁPIDO Y CERCA: Los primeros 90 minutos a 1,60€ al sellar el ticket. Pincha en el enlace 👇
https://g.co/kgs/75YYDgD

Recuerde, es importante traer sus informes médicos, pruebas diagnósticas e imágenes.`;

  const returningVisit = `Hola [CLIENTE], gracias por pedir tu cita en Fisiosport Alicante.
🗓️El día [FECHA] a las [HORA].
¡Te esperamos!`;

  const dayBefore = `Buenos días, [PACIENTE] 😊

Confirma tu cita de mañana, [FECHA], a las [HORA].

¿Podrías confirmar la cita antes de hoy a las 16:00h, por favor? Si no recibimos confirmación, tendremos que liberar la hora para otra persona.

Te recordamos también que, si finalmente necesitas cancelar o modificar la cita con menos de 24 horas de antelación, para poder reservar una nueva cita será necesario realizar el pago de la sesión por adelantado.

Muchas gracias por tu colaboración y comprensión. 😊`;

  function formatDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return String(date || '');
    return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
  }

  function render(kind, appointment, patient) {
    const template = kind === 'first' ? firstVisit : kind === 'returning' ? returningVisit : dayBefore;
    const name = appointment?.patient || patient?.name || 'Paciente';
    return template.replaceAll('[CLIENTE]', name).replaceAll('[PACIENTE]', name)
      .replaceAll('[FECHA]', formatDate(appointment?.date))
      .replaceAll('[HORA]', appointment?.start || appointment?.time || '');
  }

  root.atlasAppointmentWhatsappCopy = { firstVisit, returningVisit, dayBefore, render };
})(typeof window === 'object' ? window : globalThis);
