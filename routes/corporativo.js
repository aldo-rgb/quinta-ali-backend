const { Router } = require('express');
const pool = require('../db/connection');
const adminAuth = require('../middleware/adminAuth');
const rateLimit = require('express-rate-limit');
const { generarPDFCotizacion } = require('../services/pdfGenerator');
const { enviarCotizacion } = require('../services/email');
const { enviarMensaje } = require('../services/whatsapp');
const fs = require('fs');

const router = Router();

// Rate limiting: máximo 5 cotizaciones por IP en 1 hora
const cotizacionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { message: 'Demasiadas solicitudes de cotización. Intenta de nuevo en 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/corporativo/cotizar — Generar cotización corporativa con PDF
router.post('/cotizar', cotizacionLimiter, async (req, res) => {
  try {
    const {
      empresa,
      contacto,
      email,
      telefono,
      num_empleados,
      rfc,
      razon_social,
      fecha_evento,
      paquete_base,
      num_asistentes,
      notas,
    } = req.body;

    // Validación
    if (!empresa || !contacto || !email) {
      return res.status(400).json({ message: 'empresa, contacto y email son requeridos' });
    }

    const asistentes = Number(num_asistentes) || 50;

    // Buscar precio del paquete base (si se eligió uno)
    let precioPaquete = 15000; // Precio corporativo default
    let nombrePaquete = 'Personalizado';
    if (paquete_base) {
      const { rows } = await pool.query('SELECT nombre, precio FROM paquetes WHERE id = $1', [paquete_base]);
      if (rows.length > 0) {
        precioPaquete = Number(rows[0].precio);
        nombrePaquete = rows[0].nombre;
      }
    }

    // Cálculo corporativo: precio base + extra por asistente
    const extraPorAsistente = 150;
    const subtotal = precioPaquete + (asistentes * extraPorAsistente);
    const iva = Math.round(subtotal * 0.16 * 100) / 100;
    const total = Math.round((subtotal + iva) * 100) / 100;

    // Generar folio
    const folio = `COT-${Date.now().toString(36).toUpperCase()}`;

    // Guardar en BD
    const { rows: [lead] } = await pool.query(
      `INSERT INTO leads_corporativos
        (folio, empresa, contacto, email, telefono, num_empleados, rfc, razon_social, fecha_evento, paquete_base, num_asistentes, notas, subtotal, iva, total, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'cotizado')
       RETURNING *`,
      [folio, empresa, contacto, email, telefono || null, num_empleados || null, rfc || null, razon_social || null, fecha_evento || null, nombrePaquete, asistentes, notas || null, subtotal, iva, total]
    );

    // Generar PDF
    const pdfPath = await generarPDFCotizacion({
      folio,
      empresa,
      contacto,
      fechaEvento: fecha_evento,
      paqueteBase: nombrePaquete,
      numAsistentes: asistentes,
      subtotal,
      iva,
      total,
      notas,
    });

    // Guardar referencia al PDF
    await pool.query('UPDATE leads_corporativos SET pdf_url = $1 WHERE id = $2', [pdfPath, lead.id]);

    // Enviar correo con PDF adjunto
    const emailResult = await enviarCotizacion({
      to: email,
      contacto,
      empresa,
      folio,
      pdfPath,
    });

    // Notificar al admin por WhatsApp
    const adminPhone = process.env.ADMIN_WHATSAPP;
    if (adminPhone) {
      try {
        await enviarMensaje(
          adminPhone,
          `🏢 *Nuevo lead corporativo*\n\n` +
          `Empresa: ${empresa}\n` +
          `Contacto: ${contacto}\n` +
          `Email: ${email}\n` +
          `Asistentes: ${asistentes}\n` +
          `Total: $${total.toLocaleString('es-MX')} MXN\n` +
          `Folio: ${folio}`
        );
      } catch (e) {
        // WhatsApp notif falló (no crítico)
      }
    }

    res.json({
      ok: true,
      folio,
      total,
      subtotal,
      iva,
      emailEnviado: emailResult.sent,
      pdfGenerado: true,
    });

  } catch (err) {
    console.error('Error cotización corporativa:', err);
    res.status(500).json({ message: 'Error al generar la cotización' });
  }
});

// GET /api/corporativo/leads — Listar leads corporativos (admin)
router.get('/leads', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM leads_corporativos ORDER BY creado_en DESC LIMIT 50'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listando leads:', err);
    res.status(500).json({ message: 'Error al obtener leads' });
  }
});

// PATCH /api/corporativo/leads/:id — Actualizar estado de lead
router.patch('/leads/:id', adminAuth, async (req, res) => {
  try {
    const { estado } = req.body;
    const { id } = req.params;
    const validEstados = ['pendiente', 'cotizado', 'pagado', 'cancelado'];
    if (!validEstados.includes(estado)) {
      return res.status(400).json({ message: 'Estado inválido' });
    }
    const { rows } = await pool.query(
      'UPDATE leads_corporativos SET estado = $1, actualizado_en = NOW() WHERE id = $2 RETURNING *',
      [estado, id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Lead no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error actualizando lead:', err);
    res.status(500).json({ message: 'Error al actualizar' });
  }
});

// GET /api/corporativo/pdf/:folio — Descargar PDF de cotización
router.get('/pdf/:folio', async (req, res) => {
  try {
    const { folio } = req.params;
    // Validar formato de folio
    if (!/^COT-[A-Z0-9]+$/i.test(folio)) {
      return res.status(400).json({ message: 'Folio inválido' });
    }
    const { rows } = await pool.query(
      'SELECT pdf_url, empresa FROM leads_corporativos WHERE folio = $1',
      [folio]
    );
    if (rows.length === 0 || !rows[0].pdf_url) {
      return res.status(404).json({ message: 'PDF no encontrado' });
    }

    const pdfPath = rows[0].pdf_url;
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ message: 'Archivo PDF no disponible' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${folio}.pdf"`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    console.error('Error descargando PDF:', err);
    res.status(500).json({ message: 'Error al descargar PDF' });
  }
});

module.exports = router;
