const pool = require('../config/db');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_REGEX = /^\d{4}-\d{2}$/;
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

const isValidDate = (str) => {
  if (!DATE_REGEX.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/**
 * Acepta YYYY-MM o YYYY-MM-DD y devuelve YYYY-MM-DD (YYYY-MM → día 01), o null si es inválido.
 */
const parseMonthOrDate = (str) => {
  if (MONTH_REGEX.test(str)) {
    const candidate = `${str}-01`;
    return isValidDate(candidate) ? candidate : null;
  }
  return isValidDate(str) ? str : null;
};

/**
 * Valida startDate / endDate y agrega condiciones de solapamiento de semana
 * (semana_fin >= startDate AND semana_inicio <= endDate) o de fecha puntual.
 * Devuelve un mensaje de error o null.
 */
const buildDateFilters = (query, conditions, params, { fromColumn, toColumn }) => {
  const { startDate, endDate } = query;
  if (startDate) {
    if (!isValidDate(startDate)) return 'startDate debe ser una fecha válida con formato YYYY-MM-DD';
    params.push(startDate);
    conditions.push(`${toColumn} >= $${params.length}`);
  }
  if (endDate) {
    if (!isValidDate(endDate)) return 'endDate debe ser una fecha válida con formato YYYY-MM-DD';
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
const FISERV_MONTHLY_NUMERIC = [
  'cantidad_liquidaciones', 'total_bruto', 'total_arancel', 'total_iva', 'total_retenciones',
  'total_descuentos', 'total_neto_cobrado', 'porcentaje_descuentos',
];
const PAYMENT_METHODS_NUMERIC = ['operaciones', 'total_bruto', 'total_neto', 'participacion_porcentaje'];
const CASHFLOW_NUMERIC = ['ingresos_posnet_netos', 'egresos_compras_mercaderia', 'balance_semanal'];

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

// ── GET /api/analytics/fiserv-monthly ──
const getFiservMonthlySummary = async (req, res) => {
  const conditions = [];
  const params = [];
  const { startDate, endDate } = req.query;

  let start = null;
  let end = null;
  if (startDate) {
    start = parseMonthOrDate(startDate);
    if (!start) return res.status(400).json({ error: 'startDate debe tener formato YYYY-MM o YYYY-MM-DD válido' });
    params.push(start);
    conditions.push(`mes >= date_trunc('month', $${params.length}::date)`);
  }
  if (endDate) {
    end = parseMonthOrDate(endDate);
    if (!end) return res.status(400).json({ error: 'endDate debe tener formato YYYY-MM o YYYY-MM-DD válido' });
    params.push(end);
    conditions.push(`mes <= $${params.length}::date`);
  }
  if (start && end && start > end) {
    return res.status(400).json({ error: 'startDate no puede ser posterior a endDate' });
  }

  try {
    const result = await pool.query(
      `SELECT mes::text AS mes, mes_periodo, cantidad_liquidaciones, total_bruto, total_arancel,
              total_iva, total_retenciones, total_descuentos, total_neto_cobrado, porcentaje_descuentos
       FROM public.v_analytics_fiserv_monthly_summary
       ${whereClause(conditions)}
       ORDER BY mes DESC`,
      params
    );

    const rows = result.rows.map((r) => castRow(r, FISERV_MONTHLY_NUMERIC));

    const sums = rows.reduce(
      (acc, r) => {
        acc.bruto += toNumber(r.total_bruto);
        acc.neto += toNumber(r.total_neto_cobrado);
        acc.descuentos += toNumber(r.total_descuentos);
        acc.liquidaciones += toNumber(r.cantidad_liquidaciones);
        return acc;
      },
      { bruto: 0, neto: 0, descuentos: 0, liquidaciones: 0 }
    );

    const kpis = {
      total_bruto_acumulado: round2(sums.bruto),
      total_neto_acumulado: round2(sums.neto),
      total_descuentos_acumulado: round2(sums.descuentos),
      porcentaje_descuento_promedio: sums.bruto > 0 ? round2((sums.descuentos / sums.bruto) * 100) : 0,
      cantidad_liquidaciones_total: sums.liquidaciones,
    };

    return res.status(200).json({ data: rows, kpis });
  } catch (err) {
    console.error('Error en getFiservMonthlySummary:', err);
    return res.status(500).json({
      error: 'No se pudo obtener el resumen mensual de cobranzas',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  }
};

// ── GET /api/analytics/fiserv-payment-methods ──
const getFiservPaymentMethods = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT card_type, operaciones, total_bruto, total_neto, participacion_porcentaje
       FROM public.v_analytics_fiserv_payment_methods
       ORDER BY total_bruto DESC`
    );

    const data = result.rows.map((r) => {
      const row = castRow(r, PAYMENT_METHODS_NUMERIC);
      return { ...row, card_type: row.card_type || 'Sin especificar', name: row.card_type || 'Sin especificar', value: row.total_bruto };
    });

    const total_bruto = round2(data.reduce((s, r) => s + toNumber(r.total_bruto), 0));
    const total_neto = round2(data.reduce((s, r) => s + toNumber(r.total_neto), 0));
    const total_operaciones = data.reduce((s, r) => s + toNumber(r.operaciones), 0);

    return res.status(200).json({ data, totals: { total_bruto, total_neto, total_operaciones } });
  } catch (err) {
    console.error('Error en getFiservPaymentMethods:', err);
    return res.status(500).json({
      error: 'No se pudo obtener la distribución por medio de pago',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  }
};

// ── GET /api/analytics/cashflow ──
const getCashflowComparison = async (req, res) => {
  const conditions = [];
  const params = [];

  const dateError = buildDateFilters(req.query, conditions, params, {
    fromColumn: 'semana_inicio',
    toColumn: 'semana_inicio',
  });
  if (dateError) return res.status(400).json({ error: dateError });

  try {
    const result = await pool.query(
      `SELECT semana_inicio::text AS semana_inicio, semana_fin::text AS semana_fin,
              ingresos_posnet_netos, egresos_compras_mercaderia, balance_semanal
       FROM public.v_analytics_cashflow_comparison
       ${whereClause(conditions)}
       ORDER BY semana_inicio ASC`,
      params
    );

    const data = result.rows.map((r) => castRow(r, CASHFLOW_NUMERIC));

    const ingresos = data.reduce((s, r) => s + toNumber(r.ingresos_posnet_netos), 0);
    const egresos = data.reduce((s, r) => s + toNumber(r.egresos_compras_mercaderia), 0);

    const totals = {
      ingresos_acumulados: round2(ingresos),
      egresos_acumulados: round2(egresos),
      neto_periodo: round2(ingresos - egresos),
      semanas: data.length,
      semanas_positivas: data.filter((r) => toNumber(r.balance_semanal) >= 0).length,
    };

    return res.status(200).json({ data, totals });
  } catch (err) {
    console.error('Error en getCashflowComparison:', err);
    return res.status(500).json({
      error: 'No se pudo obtener la comparativa de flujo de caja',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  }
};

module.exports = {
  getWeeklyPurchasesSummary,
  getMeatWeightsDistribution,
  getSupplierPurchasesShare,
  getFiservMonthlySummary,
  getFiservPaymentMethods,
  getCashflowComparison,
};
