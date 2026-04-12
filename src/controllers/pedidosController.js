const pool = require('../config/db');

const createPedido = async (req, res) => {
  const { items, total_estimado, total, comentarios } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items inválidos' });
  }

  const totalNumber = Number(total_estimado ?? total);
  if (!Number.isFinite(totalNumber) || totalNumber < 0) {
    return res.status(400).json({ error: 'Total inválido' });
  }

  const comentariosStr = comentarios == null ? null : String(comentarios);

  try {
    const result = await pool.query(
      "INSERT INTO pedidos (items, total_estimado, comentarios, created_at, estado) VALUES ($1::jsonb, $2, $3, NOW(), 'pendiente') RETURNING *",
      [JSON.stringify(items), totalNumber, comentariosStr]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al registrar pedido:', err);
    return res.status(503).json({
      error: 'No se pudo registrar el pedido',
      mensaje: 'Intenta nuevamente más tarde'
    });
  }
};

const getPedidos = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, items, total_estimado, comentarios, created_at, estado FROM pedidos ORDER BY created_at DESC'
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error al consultar pedidos:', err);
    res.status(503).json({
      error: 'No se pudo conectar con la base de datos',
      mensaje: 'Intenta nuevamente más tarde'
    });
  }
};

const updatePedidoEstado = async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body || {};

  const estadosValidos = ['pendiente', 'preparando', 'entregado'];
  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido. Usa: pendiente, preparando o entregado' });
  }

  try {
    const result = await pool.query(
      'UPDATE pedidos SET estado = $1 WHERE id = $2 RETURNING *',
      [estado, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error al actualizar pedido:', err);
    return res.status(503).json({
      error: 'No se pudo actualizar el pedido',
      mensaje: 'Intenta nuevamente más tarde'
    });
  }
};

module.exports = {
  createPedido,
  getPedidos,
  updatePedidoEstado,
};
