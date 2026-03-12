const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const TEAL = '#0d9e8f';
const DARK = '#1f2937';
const GRAY = '#6b7280';
const LIGHT = '#e5e7eb';
const RED = '#dc2626';

function fmt(n) {
  return Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Genera un PDF de cotización corporativa y lo guarda en /tmp
 * @returns {Promise<string>} ruta al archivo PDF temporal
 */
function generarPDFCotizacion({ folio, empresa, contacto, fechaEvento, paqueteBase, numAsistentes, subtotal, iva, total, notas }) {
  return new Promise((resolve, reject) => {
    try {
      const hoy = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
      const fechaEvFmt = fechaEvento
        ? new Date(fechaEvento + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })
        : 'Por definir';

      const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 60, left: 50, right: 50 } });
      const filePath = path.join('/tmp', `${folio}.pdf`);
      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      const W = 495; // usable width

      // ── Header ──
      doc.fontSize(20).font('Helvetica-Bold').fillColor(TEAL).text('LA QUINTA DE ALÍ', 50, 50);
      doc.fontSize(9).font('Helvetica').fillColor(GRAY).text('Santiago, Nuevo León', 50, 74);

      doc.fontSize(14).font('Helvetica-Bold').fillColor(DARK).text('COTIZACIÓN CORPORATIVA', 300, 50, { align: 'right', width: W - 250 });
      doc.fontSize(9).font('Helvetica').fillColor(GRAY).text(`Folio: ${folio}`, 300, 70, { align: 'right', width: W - 250 });
      doc.fontSize(9).text(`Fecha: ${hoy}`, 300, 83, { align: 'right', width: W - 250 });

      // ── Línea teal ──
      doc.moveTo(50, 100).lineTo(50 + W, 100).lineWidth(2).strokeColor(TEAL).stroke();

      // ── Datos del Solicitante ──
      let y = 120;
      doc.fontSize(11).font('Helvetica-Bold').fillColor(TEAL).text('DATOS DEL SOLICITANTE', 50, y);
      y += 22;

      const rows1 = [
        ['Empresa', empresa],
        ['Contacto', contacto],
        ['Fecha del evento', fechaEvFmt],
        ['No. de asistentes', String(numAsistentes || 'Por definir')],
      ];
      for (const [label, value] of rows1) {
        doc.moveTo(50, y).lineTo(50 + W, y).lineWidth(0.5).strokeColor(LIGHT).stroke();
        doc.fontSize(10).font('Helvetica').fillColor(GRAY).text(label, 55, y + 6, { width: 130 });
        doc.fontSize(10).font('Helvetica').fillColor(DARK).text(value, 190, y + 6, { width: W - 145 });
        y += 28;
      }
      doc.moveTo(50, y).lineTo(50 + W, y).lineWidth(0.5).strokeColor(LIGHT).stroke();

      // ── Desglose de Inversión ──
      y += 20;
      doc.fontSize(11).font('Helvetica-Bold').fillColor(TEAL).text('DESGLOSE DE INVERSIÓN', 50, y);
      y += 22;

      // Header row
      doc.rect(50, y, W, 24).fill('#f9fafb');
      doc.fontSize(9).font('Helvetica-Bold').fillColor(GRAY).text('Concepto', 58, y + 7, { width: W - 140 });
      doc.text('Monto', 50 + W - 130, y + 7, { width: 122, align: 'right' });
      y += 24;
      doc.moveTo(50, y).lineTo(50 + W, y).lineWidth(1).strokeColor(LIGHT).stroke();

      // Rows
      const desgloseRows = [
        [`Paquete: ${paqueteBase || 'Personalizado'}`, `$${fmt(subtotal)}`],
        ['IVA (16%)', `$${fmt(iva)}`],
      ];
      for (const [concepto, monto] of desgloseRows) {
        y += 4;
        doc.fontSize(10).font('Helvetica').fillColor(DARK).text(concepto, 58, y + 4, { width: W - 140 });
        doc.text(monto, 50 + W - 130, y + 4, { width: 122, align: 'right' });
        y += 24;
        doc.moveTo(50, y).lineTo(50 + W, y).lineWidth(0.5).strokeColor(LIGHT).stroke();
      }

      // Total row
      y += 4;
      doc.moveTo(50, y + 22).lineTo(50 + W, y + 22).lineWidth(2).strokeColor(TEAL).stroke();
      doc.fontSize(12).font('Helvetica-Bold').fillColor(DARK).text('TOTAL', 58, y + 4, { width: W - 140 });
      doc.fontSize(12).font('Helvetica-Bold').fillColor(TEAL).text(`$${fmt(total)} MXN`, 50 + W - 130, y + 4, { width: 122, align: 'right' });
      y += 30;

      // ── Datos Bancarios ──
      y += 16;
      doc.fontSize(11).font('Helvetica-Bold').fillColor(TEAL).text('DATOS PARA TRANSFERENCIA (SPEI)', 50, y);
      y += 22;

      const clabe = process.env.CLABE_BANCARIA || '012345678901234567';
      const rowsBanco = [
        ['Banco', 'Banorte'],
        ['Beneficiario', 'La Quinta de Alí'],
        ['CLABE', clabe],
        ['Concepto', `${folio} - ${empresa}`],
      ];
      for (const [label, value] of rowsBanco) {
        doc.moveTo(50, y).lineTo(50 + W, y).lineWidth(0.5).strokeColor(LIGHT).stroke();
        doc.fontSize(10).font('Helvetica').fillColor(GRAY).text(label, 55, y + 6, { width: 130 });
        doc.fontSize(10).font(label === 'CLABE' ? 'Helvetica-Bold' : 'Helvetica').fillColor(DARK).text(value, 190, y + 6, { width: W - 145 });
        y += 28;
      }
      doc.moveTo(50, y).lineTo(50 + W, y).lineWidth(0.5).strokeColor(LIGHT).stroke();

      // ── Notas ──
      if (notas) {
        y += 20;
        doc.fontSize(11).font('Helvetica-Bold').fillColor(TEAL).text('NOTAS ADICIONALES', 50, y);
        y += 18;
        doc.fontSize(10).font('Helvetica-Oblique').fillColor('#374151').text(notas, 55, y, { width: W - 10 });
        y += doc.heightOfString(notas, { width: W - 10 }) + 8;
      }

      // ── Vigencia (texto rojo) ──
      y += 28;
      doc.fontSize(11).font('Helvetica-Bold').fillColor(RED).text(
        'Vigencia de la cotización: 5 días hábiles. Sujeto a disponibilidad de fecha.',
        50, y, { align: 'center', width: W }
      );

      // ── Condiciones ──
      y += 24;
      doc.fontSize(8).font('Helvetica').fillColor('#9ca3af').text(
        'Al realizar el pago SPEI por el monto total indicado, se considerará la fecha como reservada. ' +
        'Se emitirá factura CFDI 4.0 al RFC proporcionado dentro de las 24 hrs posteriores al pago. ' +
        'Cancelaciones con menos de 7 días de anticipación no son reembolsables.',
        50, y, { width: W, lineGap: 3 }
      );

      doc.end();

      writeStream.on('finish', () => resolve(filePath));
      writeStream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generarPDFCotizacion };
