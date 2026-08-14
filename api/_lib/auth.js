const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function getUserFromRequest(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return verifyToken(auth.slice(7));
}

function requireAdmin(req, res, fail) {
  const user = getUserFromRequest(req);
  if (!user || user.role !== 'admin') {
    fail(res, '관리자 권한이 필요합니다', 403);
    return null;
  }
  return user;
}

module.exports = { signToken, verifyToken, getUserFromRequest, requireAdmin };
