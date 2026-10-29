const { supabase } = require('../config/supabase');

const requireAuth = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({
      error: 'No autorizado',
      mensaje: 'Falta el token de sesión. Iniciá sesión nuevamente.',
    });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({
        error: 'No autorizado',
        mensaje: 'La sesión es inválida o expiró. Iniciá sesión nuevamente.',
      });
    }

    req.user = data.user;
    return next();
  } catch (err) {
    console.error('Error validando token de Supabase:', err);
    return res.status(500).json({
      error: 'Error interno al validar la sesión',
    });
  }
};

module.exports = { requireAuth };
