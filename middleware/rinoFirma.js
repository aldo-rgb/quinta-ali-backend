/**
 * Verifica que una petición venga de Grupo Rino: X-Signature = sha256=HMAC del
 * cuerpo crudo con el secreto compartido. Deja el JSON en `req.cuerpoRino`.
 *
 * La ruta tiene que recibir el cuerpo con express.raw(): express.json() lo
 * vuelve a serializar y la firma deja de cuadrar.
 */
const rino = require('../services/rino');

function rinoFirma(req, res, next) {
  if (!process.env.RINO_WEBHOOK_SECRET) {
    return res.status(503).json({
      ok: false, resultado: 'sin_configurar', detalle: 'Quinta de Ali no tiene el secreto de firma configurado',
    });
  }

  const crudo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!rino.firmaValida(crudo, req.get('x-signature'))) {
    return res.status(401).json({ ok: false, resultado: 'firma_invalida', detalle: 'X-Signature no coincide con el cuerpo' });
  }

  try {
    req.cuerpoRino = JSON.parse(crudo.toString('utf8'));
  } catch {
    return res.status(400).json({ ok: false, resultado: 'no_es_json', detalle: 'El cuerpo no es JSON' });
  }
  next();
}

module.exports = rinoFirma;
