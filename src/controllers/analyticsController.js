const pool = require('../config/db');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toNumber = (v) => (v === null || v === undefined ? 0 : Number(v));
const round2 = (n) => Math.round(n * 100) / 100;

const castRow = (row, numericFields) => {
  const out = { ...row };
  numericFields.forEach((f) => {
    if (f in out) out[f] = out[f] === null ? null : Number(out[f]);
  });
  return out;
};

const isTruthy = (v) => ['true', '1', 'yes', 'si'].includes(String(v || '').toLowerCase());

/**
 * Valida startDate / endDate y agrega condiciones de solapamiento de semana
 * (semana_fin >= startDate AND semana_inicio <= endDate) o de fecha puntual.
 * Devuelve un mensaje de error o null.
 */
const buildDateFilters = (query, conditions, params, { fromColumn, toColumn }) => {
  const { startDate, endDate } = query;
  if (startDate) {
    if (!DATE_REGEX.test(startDate)) return 'startDate debe tener formato YYYY-MM-DD';
    params.push(startDate);
    conditions.push(`${toColumn} >= $${params.length}`);
  }
  if (endDate) {
    if (!DATE_REGEX.test(endDate)) return 'endDate debe tener formato YYYY-MM-DD';
    params.push(endDate);
    conditions.push(`${fromColumn} <= $${params.length}`);
  }
  if (startDate && endDate && startDate > endDate) return 'startDate no puede ser posterior a endDate';
  return null;
};

const whereClause = (conditions) => (conditions.length ? `WHERE ${conditions.join(' AND ')}` : '');

const WEEKLY_NUMERIC = ['cantidad_remitos', 'total_piezas_pesadas', 'total_kilos_pesados', 'total_invertido'];
const DISTRIBUTION_NUMERIC = [
  'cantidad_piezas', 'peso_promedio_pieza', 'peso_minimo_pieza', 'peso_maximo_pieza',
  'kilos_totales_lote', 'precio_por_kilo', 'total_linea',
];

// ── GET /api/analytics/weekly-purchases ──
const getWeeklyPurchasesSummary = async (req, res) => {
  const conditions = [];
  const params = [];

  const dateError = buildDateFilters(req.query, conditions, params, {
    fromColumn: 'semana_inicio',
    toColumn: 'semana_fin',
  });
  if (dateError) return res.status(400).json({ error: dateError });

  const { supplierId } = req.query;
  if (supplierId) {
    if (!UUID_REGEX.test(supplierId)) {
      return res.status(400).json({ error: 'supplierId debe ser un UUID válido' });
    }
    params.push(supplierId);
    conditions.push(`supplier_id = $${params.length}`);
  }

  try {
    const result = await pool.query(
      `SELECT semana_inicio::text AS semana_inicio, semana_fin::text AS semana_fin, supplier_id, proveedor, rubro_proveedor,
              cantidad_remitos, total_piezas_pesadas, total_kilos_pesados, total_invertido
       FROM public.v_analytics_weekly_purchases
       ${whereClause(conditions)}
       ORDER BY semana_inicio DESC, total_invertido DESC`,
      params
    );

    const rows = result.rows.map((r) => castRow(r, WEEKLY_NUMERIC));

    const kpis = rows.reduce(
      (acc, r) => {
        acc.total_invertido_acumulado += toNumber(r.total_invertido);
        acc.total_kilos_acumulados += toNumber(r.total_kilos_pesados);
        acc.total_piezas_acumuladas += toNumber(r.total_piezas_pesadas);
        acc.total_remitos_acumulados += toNumber(r.cantidad_remitos);
        return acc;
      },
      { total_invertido_acumulado: 0, total_kilos_acumulados: 0, total_piezas_acumuladas: 0, total_remitos_acumulados: 0 }
    );
    kpis.total_invertido_acumulado = round2(kpis.total_invertido_acumulado);
    kpis.total_kilos_acumulados = round2(kpis.total_kilos_acumulados);

    return res.status(200).json({ data: rows, kpis });
  } catch (err) {
    console.error('Error en getWeeklyPurchasesSummary:', err);
    return res.status(500).json({
      error: 'No se pudo obtener el resumen semanal de compras',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  }
};

// ── GET /api/analytics/weights-distribution ──
const getMeatWeightsDistribution = async (req, res) => {
  const conditions = [];
  const params = [];

  const dateError = buildDateFilters(req.query, conditions, params, {
    fromColumn: 'fecha_remito',
    toColumn: 'fecha_remito',
  });
  if (dateError) return res.status(400).json({ error: dateError });

  const { supplierName, product, includeEmpty, onlyKg } = req.query;

  if (supplierName && String(supplierName).trim()) {
    params.push(`%${String(supplierName).trim()}%`);
    conditions.push(`proveedor ILIKE $${params.length}`);
  }
  if (product && String(product).trim()) {
    params.push(`%${String(product).trim()}%`);
    conditions.push(`producto ILIKE $${params.length}`);
  }
  if (!isTruthy(includeEmpty)) {
    conditions.push('cantidad_piezas > 0');
  }
  if (isTruthy(onlyKg)) {
    conditions.push(`unit_type = 'kg'`);
  }

  try {
    const result = await pool.query(
      `SELECT fecha_remito::text AS fecha_remito, proveedor, producto, unit_type, cantidad_piezas,
              peso_promedio_pieza, peso_minimo_pieza, peso_maximo_pieza,
              kilos_totales_lote, precio_por_kilo, total_linea
       FROM public.v_analytics_meat_weights_distribution
       ${whereClause(conditions)}
       ORDER BY fecha_remito DESC`,
      params
    );

    const rows = result.rows.map((r) => castRow(r, DISTRIBUTION_NUMERIC));
    return res.status(200).json({ data: rows, count: rows.length });
  } catch (err) {
    console.error('Error en getMeatWeightsDistribution:', err);
    return res.status(500).json({
      error: 'No se pudo obtener la distribución de pesos',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  }
};

// ── GET /api/analytics/suppliers-share ──
const getSupplierPurchasesShare = async (req, res) => {
  const conditions = [];
  const params = [];

  const dateError = buildDateFilters(req.query, conditions, params, {
    fromColumn: 'semana_inicio',
    toColumn: 'semana_fin',
  });
  if (dateError) return res.status(400).json({ error: dateError });

  try {
    const result = await pool.query(
      `SELECT proveedor,
              rubro_proveedor,
              SUM(total_invertido) AS total_gastado,
              SUM(total_kilos_pesados) AS total_kilos,
              SUM(cantidad_remitos) AS cantidad_remitos
       FROM public.v_analytics_weekly_purchases
       ${whereClause(conditions)}
       GROUP BY proveedor, rubro_proveedor
       ORDER BY total_gastado DESC`,
      params
    );

    const totalGeneral = result.rows.reduce((s, r) => s + toNumber(r.total_gastado), 0);
    let acumulado = 0;

    const data = result.rows.map((r) => {
      const totalGastado = round2(toNumber(r.total_gastado));
      acumulado += totalGastado;
      return {
        name: r.proveedor,
        rubro: r.rubro_proveedor,
        value: totalGastado,
        total_gastado: totalGastado,
        total_kilos: round2(toNumber(r.total_kilos)),
        cantidad_remitos: toNumber(r.cantidad_remitos),
        porcentaje: totalGeneral > 0 ? round2((totalGastado / totalGeneral) * 100) : 0,
        porcentaje_acumulado: totalGeneral > 0 ? round2((acumulado / totalGeneral) * 100) : 0,
      };
    });

    return res.status(200).json({ data, total_general: round2(totalGeneral) });
  } catch (err) {
    console.error('Error en getSupplierPurchasesShare:', err);
    return res.status(500).json({
      error: 'No se pudo obtener la participación por proveedor',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  }
};

module.exports = {
  getWeeklyPurchasesSummary,
  getMeatWeightsDistribution,
  getSupplierPurchasesShare,
};
