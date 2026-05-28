const pool = require('../config/db');
const csv = require('csv-parser');
const { Readable } = require('stream');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convierte DD/MM/YYYY → YYYY-MM-DD para PostgreSQL.
 * Devuelve null si el string está vacío o malformado.
 */
const parseArgDate = (str) => {
  if (!str || !str.trim()) return null;
  const parts = str.trim().split('/');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return null;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
};

/**
 * Limpia montos en formato argentino ($1.234,56 o 1.234.567,89)
 * y los convierte a float para PostgreSQL.
 */
const parseArgAmount = (str) => {
  if (!str) return 0;
  const trimmed = str.trim();
  if (!trimmed || trimmed === '-' || trimmed === '') return 0;
  const cleaned = trimmed
    .replace(/\$/g, '')       // quitar símbolo $
    .replace(/\s/g, '')       // quitar espacios
    .replace(/\./g, '')       // quitar puntos de miles
    .replace(',', '.');       // convertir coma decimal → punto
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

/**
 * Busca el valor de una columna en una fila CSV.
 * Prueba primero coincidencia exacta y luego coincidencia parcial (includes),
 * ambas case-insensitive y con espacios normalizados.
 * Acepta múltiples nombres candidatos (aliases).
 */
const col = (row, ...candidates) => {
  const normalizeKey = (s) => s.trim().toUpperCase().replace(/\s+/g, ' ');
  const rowKeys = Object.keys(row);

  // 1. Coincidencia exacta
  for (const rawKey of rowKeys) {
    const nk = normalizeKey(rawKey);
    for (const c of candidates) {
      if (nk === normalizeKey(c)) return (row[rawKey] || '').trim();
    }
  }

  // 2. Coincidencia parcial (el header contiene el candidato)
  for (const rawKey of rowKeys) {
    const nk = normalizeKey(rawKey);
    for (const c of candidates) {
      if (nk.includes(normalizeKey(c))) return (row[rawKey] || '').trim();
    }
  }

  return '';
};

/**
 * Parsea el buffer del CSV a un array de objetos.
 * Auto-detecta separador `;` o `,`.
 * Soporta BOM UTF-8 y normaliza los nombres de columna (trim).
 */
const parseCSVBuffer = (buffer) => {
  return new Promise((resolve, reject) => {
    let content = buffer.toString('utf8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1); // strip BOM

    const firstLine = content.split('\n')[0] || '';
    const separator = firstLine.includes(';') ? ';' : ',';

    const results = [];
    Readable.from(content)
      .pipe(csv({ separator, mapHeaders: ({ header }) => header.trim() }))
      .on('data', (row) => results.push(row))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
};

// ── Controller ────────────────────────────────────────────────────────────────

const uploadSettlements = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo CSV.' });
    }

    let rows;
    try {
      rows = await parseCSVBuffer(req.file.buffer);
    } catch (parseErr) {
      console.error('Error al parsear CSV:', parseErr);
      return res.status(422).json({
        error: 'El archivo CSV no pudo ser procesado.',
        detalle: 'Verificá que sea un CSV válido con el formato de Fiserv.',
      });
    }

    if (!rows || rows.length === 0) {
      return res.status(422).json({ error: 'El archivo CSV está vacío o no tiene filas de datos.' });
    }

    let inserted = 0;
    let skipped = 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const row of rows) {
        const liquidationNumber = col(row, 'NUMERO LIQUIDACION');

        // Ignorar filas vacías o de totales (sin número de liquidación)
        if (!liquidationNumber) {
          skipped++;
          continue;
        }

        const paymentDate       = parseArgDate(col(row, 'FECHA DE PAGO'));
        const presentationDate  = parseArgDate(col(row, 'FECHA DE PRESENTACION'));
        const cardType          = col(row, 'TARJETA');
        const grossAmount       = parseArgAmount(col(row, 'TOTAL IMPORTE ACEPTADO', 'VENTAS C/DESCUENTO'));
        const netAmount         = parseArgAmount(col(row, 'IMPORTE NETO DE PAGOS'));
        const arancelAmount     = parseArgAmount(col(row, 'ARANCEL'));
        const ivaAmount         = parseArgAmount(col(row, 'IVA CRED.FISC.COMERCIO'));
        const taxWithholding    = parseArgAmount(col(row, 'RETENCION ING.BRUTOS SIRTAC', 'SIRTAC'));
        const financialCost     = parseArgAmount(col(row, 'DTO S/VENTAS FIN ADQ CONT'));

        const result = await client.query(
          `INSERT INTO fiserv_daily_settlements
             (liquidation_number, payment_date, presentation_date, card_type,
              gross_amount, net_amount, arancel_amount, iva_amount,
              tax_withholding_amount, financial_cost_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (liquidation_number) DO NOTHING
           RETURNING id`,
          [
            liquidationNumber, paymentDate, presentationDate, cardType,
            grossAmount, netAmount, arancelAmount, ivaAmount,
            taxWithholding, financialCost,
          ]
        );

        if (result.rowCount > 0) inserted++;
        else skipped++;
      }

      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

    return res.status(200).json({
      success: true,
      total_records: rows.length,
      inserted_records: inserted,
      skipped_records: skipped,
    });
  } catch (err) {
    console.error('Error en uploadSettlements:', err);
    return res.status(500).json({
      error: 'Error interno al procesar el archivo.',
      mensaje: err.message,
    });
  }
};

const getRecentSettlements = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, liquidation_number, payment_date, card_type,
              gross_amount, net_amount, arancel_amount, iva_amount,
              tax_withholding_amount, financial_cost_amount
       FROM fiserv_daily_settlements
       ORDER BY payment_date DESC, id DESC
       LIMIT 10`
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error al obtener liquidaciones recientes:', err);
    return res.status(500).json({ error: 'Error al obtener liquidaciones.' });
  }
};

module.exports = { uploadSettlements, getRecentSettlements };
