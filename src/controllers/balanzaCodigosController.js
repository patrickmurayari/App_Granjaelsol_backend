const pool = require('../config/db');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parseBool = (v, fallback) => {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  return String(v).toLowerCase() === 'true';
};

const validatePayload = ({ codigo, nombre, categoria }) => {
  const codigoNum = Number(codigo);
  if (!Number.isInteger(codigoNum) || codigoNum <= 0) {
    return { error: 'El código debe ser un número entero positivo' };
  }
  const nombreClean = typeof nombre === 'string' ? nombre.trim() : '';
  if (!nombreClean) return { error: 'El nombre es obligatorio' };
  const categoriaClean = typeof categoria === 'string' ? categoria.trim() : '';
  if (!categoriaClean) return { error: 'La categoría es obligatoria' };
  return { codigo: codigoNum, nombre: nombreClean, categoria: categoriaClean };
};

const serverError = (res, err, msg) => {
  console.error(msg, err);
  return res.status(500).json({ error: msg, mensaje: 'Intenta nuevamente más tarde.' });
};

const getBalanzaCodigos = async (req, res) => {
  const { categoria, soloActivos } = req.query;
  const conditions = [];
  const params = [];

  if (categoria) {
    params.push(categoria);
    conditions.push(`categoria = $${params.length}`);
  }
  if (parseBool(soloActivos, false)) {
    conditions.push('activo = true');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await pool.query(
      `SELECT * FROM public.balanza_codigos ${where} ORDER BY categoria ASC, codigo ASC`,
      params
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    return serverError(res, err, 'No se pudieron obtener los códigos de balanza');
  }
};

const createBalanzaCodigo = async (req, res) => {
  const body = req.body || {};
  const valid = validatePayload(body);
  if (valid.error) return res.status(400).json({ error: valid.error });
  const activo = parseBool(body.activo, true);

  try {
    const result = await pool.query(
      `INSERT INTO public.balanza_codigos (codigo, nombre, categoria, activo)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [valid.codigo, valid.nombre, valid.categoria, activo]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un registro con ese código' });
    }
    return serverError(res, err, 'No se pudo crear el código de balanza');
  }
};

const updateBalanzaCodigo = async (req, res) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) return res.status(400).json({ error: 'ID inválido' });

  const body = req.body || {};
  const valid = validatePayload(body);
  if (valid.error) return res.status(400).json({ error: valid.error });

  try {
    const result = await pool.query(
      `UPDATE public.balanza_codigos
       SET codigo = $1, nombre = $2, categoria = $3, activo = COALESCE($4, activo)
       WHERE id = $5 RETURNING *`,
      [valid.codigo, valid.nombre, valid.categoria, body.activo === undefined ? null : parseBool(body.activo, true), id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Registro no encontrado' });
    return res.status(200).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un registro con ese código' });
    }
    return serverError(res, err, 'No se pudo actualizar el código de balanza');
  }
};

const toggleActivo = async (req, res) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const result = await pool.query(
      'UPDATE public.balanza_codigos SET activo = NOT activo WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Registro no encontrado' });
    return res.status(200).json(result.rows[0]);
  } catch (err) {
    return serverError(res, err, 'No se pudo cambiar el estado');
  }
};

const toggleCategoria = async (req, res) => {
  const { categoria, activo } = req.body || {};
  if (typeof categoria !== 'string' || !categoria.trim()) {
    return res.status(400).json({ error: 'La categoría es obligatoria' });
  }
  if (typeof activo !== 'boolean') {
    return res.status(400).json({ error: 'activo debe ser booleano' });
  }

  try {
    const result = await pool.query(
      'UPDATE public.balanza_codigos SET activo = $2 WHERE categoria = $1 RETURNING *',
      [categoria.trim(), activo]
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    return serverError(res, err, 'No se pudo actualizar la categoría');
  }
};

const deleteBalanzaCodigo = async (req, res) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const result = await pool.query(
      'DELETE FROM public.balanza_codigos WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Registro no encontrado' });
    return res.status(200).json({ mensaje: 'Código eliminado', id });
  } catch (err) {
    return serverError(res, err, 'No se pudo eliminar el código de balanza');
  }
};

module.exports = {
  getBalanzaCodigos,
  createBalanzaCodigo,
  updateBalanzaCodigo,
  toggleActivo,
  toggleCategoria,
  deleteBalanzaCodigo,
};
