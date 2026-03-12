const nodemailer = require('nodemailer');

// Configura tu transporte SMTP
// Para producción usa tu proveedor real (Gmail, Resend, SendGrid, etc.)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Envía un correo con la cotización PDF adjunta
 */
async function enviarCotizacion({ to, contacto, empresa, folio, pdfPath }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log('⚠️  SMTP no configurado — correo no enviado. PDF en:', pdfPath);
    return { sent: false, reason: 'SMTP no configurado' };
  }

  const mailOptions = {
    from: `"La Quinta de Alí" <${process.env.SMTP_USER}>`,
    to,
    subject: `Cotización Evento Corporativo ${folio} — La Quinta de Alí`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#0d9e8f;padding:24px;text-align:center;border-radius:12px 12px 0 0;">
          <h1 style="color:#fff;margin:0;font-size:22px;">La Quinta de Alí</h1>
          <p style="color:#d1fae5;margin:4px 0 0;font-size:13px;">Cotización Corporativa</p>
        </div>
        <div style="padding:24px;background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
          <p style="color:#1f2937;">Hola <strong>${contacto}</strong>,</p>
          <p style="color:#374151;">Adjunto encontrarás la cotización formal <strong>${folio}</strong> para el evento corporativo de <strong>${empresa}</strong>.</p>
          <p style="color:#374151;">Puedes realizar el pago vía <strong>SPEI</strong> con la CLABE indicada en el PDF. Una vez confirmado el depósito, tu fecha queda reservada automáticamente.</p>
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin:16px 0;text-align:center;">
            <p style="color:#dc2626;font-weight:bold;margin:0;">⏰ Vigencia: 5 días hábiles</p>
            <p style="color:#991b1b;font-size:12px;margin:4px 0 0;">Sujeto a disponibilidad de fecha</p>
          </div>
          <p style="color:#6b7280;font-size:12px;">¿Dudas? Contáctanos por WhatsApp: <a href="https://wa.me/${process.env.ADMIN_WHATSAPP}" style="color:#0d9e8f;">${process.env.ADMIN_WHATSAPP}</a></p>
        </div>
      </div>
    `,
    attachments: [
      {
        filename: `${folio}.pdf`,
        path: pdfPath,
        contentType: 'application/pdf',
      },
    ],
  };

  const info = await transporter.sendMail(mailOptions);
  return { sent: true, messageId: info.messageId };
}

module.exports = { enviarCotizacion };
