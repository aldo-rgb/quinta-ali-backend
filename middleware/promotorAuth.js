const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function promotorAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token requerido' });
  }

  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'promotor') {
      return res.status(403).json({ message: 'Acceso denegado' });
    }
    req.promotor = decoded;
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido o expirado' });
  }
}

module.exports = promotorAuth;
