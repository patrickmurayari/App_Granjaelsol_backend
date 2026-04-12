const pool = require('../config/db');

const getCierres = async (req, res) => {
  const { limite = 7 } = req.query;

  try {
    const result = await pool.query(
      'SELECT id, fecha, venta_total_balanza, venta_posnet, venta_transferencias, fondo_inicial, efectivo_final, gastos_del_dia, diferencia_caja, notas, created_at FROM cierres_caja ORDER BY fecha DESC LIMIT $1',
      [Number(limite)]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error al consultar cierres:', err);
    res.status(503).json({
      error: 'No se pudo conectar con la base de datos',
      mensaje: 'Intenta nuevamente más tarde'
    });
  }
};

const createOrUpdateCierre = async (req, res) => {
  const {
    venta_total_balanza,
    venta_posnet,
    venta_transferencias,
    fondo_inicial,
    efectivo_final,
    gastos_del_dia,
    notas
  } = req.body || {};

  const ventaBalanza = Number(venta_total_balanza) || 0;
  const posnet = Number(venta_posnet) || 0;
  const transferencias = Number(venta_transferencias) || 0;
  const fondoInicial = Number(fondo_inicial) || 0;
  const efectivoFinal = Number(efectivo_final) || 0;
  const gastos = Number(gastos_del_dia) || 0;
  const notasStr = notas?.trim() || null;

  const hoy = new Date().toISOString().split('T')[0];

  try {
    const existingResult = await pool.query(
      'SELECT id FROM cierres_caja WHERE fecha = $1',
      [hoy]
    );

    let result;

    if (existingResult.rows.length > 0) {
      result = await pool.query(
        `UPDATE cierres_caja SET
          venta_total_balanza = $1,
          venta_posnet = $2,
          venta_transferencias = $3,
          fondo_inicial = $4,
          efectivo_final = $5,
          gastos_del_dia = $6,
          notas = $7,
          fecha = NOW()
        WHERE fecha = $8 RETURNING *`,
        [ventaBalanza, posnet, transferencias, fondoInicial, efectivoFinal, gastos, notasStr, hoy]
      );
    } else {
      result = await pool.query(
        `INSERT INTO cierres_caja (
          fecha, venta_total_balanza, venta_posnet, venta_transferencias,
          fondo_inicial, efectivo_final, gastos_del_dia, notas, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *`,
        [hoy, ventaBalanza, posnet, transferencias, fondoInicial, efectivoFinal, gastos, notasStr]
      );
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error al guardar cierre:', err);
    return res.status(503).json({
      error: 'No se pudo guardar el cierre',
      mensaje: 'Intenta nuevamente más tarde'
    });
  }
};

const updateCierre = async (req, res) => {
  const { id } = req.params;
  const {
    venta_total_balanza,
    venta_posnet,
    venta_transferencias,
    fondo_inicial,
    efectivo_final,
    gastos_del_dia,
    notas
  } = req.body || {};

  const ventaBalanza = Number(venta_total_balanza) || 0;
  const posnet = Number(venta_posnet) || 0;
  const transferencias = Number(venta_transferencias) || 0;
  const fondoInicial = Number(fondo_inicial) || 0;
  const efectivoFinal = Number(efectivo_final) || 0;
  const gastos = Number(gastos_del_dia) || 0;
  const notasStr = notas?.trim() || null;

  if (!id) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const result = await pool.query(
      `UPDATE cierres_caja SET
        venta_total_balanza = $1,
        venta_posnet = $2,
        venta_transferencias = $3,
        fondo_inicial = $4,
        efectivo_final = $5,
        gastos_del_dia = $6,
        notas = $7,
        fecha = NOW()
      WHERE id = $8 RETURNING *`,
      [ventaBalanza, posnet, transferencias, fondoInicial, efectivoFinal, gastos, notasStr, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cierre no encontrado' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error al actualizar cierre:', err);
    return res.status(503).json({
      error: 'No se pudo actualizar el cierre',
      mensaje: 'Intenta nuevamente más tarde'
    });
  }
};

module.exports = {
  getCierres,
  createOrUpdateCierre,
  updateCierre,
};
