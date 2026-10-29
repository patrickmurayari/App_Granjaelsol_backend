const pool = require('../config/db');
const csv = require('csv-parser');
const { Readable } = require('stream');
const sharp = require('sharp');
const { supabase } = require('../config/supabase');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convierte DD/MM/YYYY o DD/MM/YYYY HH:mm:ss → YYYY-MM-DD para PostgreSQL.
 * Devuelve null si el string está vacío o malformado.
 */
const parseArgDate = (str) => {
  if (!str || !str.toString().trim()) return null;
  const dateOnly = str.toString().trim().split(/\s+/)[0];
  const parts = dateOnly.split('/');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return null;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
};

/**
 * Parsea montos contemplando:
 * - Formato argentino con punto y coma: "1.234,56" -> 1234.56
 * - Formato estándar internacional con punto: "55384.45" o "-553.84" -> 55384.45 o 553.84
 * - Formato con coma decimal: "1234,56" -> 1234.56
 * - Signos de pesos "$" y espacios.
 * Si absolute === true, devuelve el valor absoluto positivo.
 */
const parseArgAmount = (str, absolute = false) => {
  if (str === undefined || str === null) return 0;
  let s = String(str).trim().replace(/\$/g, '').replace(/\s/g, '');
  if (!s || s === '-' || s.toLowerCase() === 'nan') return 0;

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (hasComma) {
    s = (s.match(/,/g).length > 1) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (hasDot && s.match(/\./g).length > 1) {
    s = s.replace(/\./g, '');
  }

  const num = parseFloat(s);
  if (isNaN(num)) return 0;
  return absolute ? Math.abs(num) : num;
};

/**
 * Busca columna tolerando mayúsculas, tildes/acentos y coincidencias parciales.
 * Los candidatos se evalúan en orden de prioridad.
 */
const normalizeHeader = (s) =>
  String(s)
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

const col = (row, ...candidates) => {
  const keys = Object.keys(row).map((rawKey) => ({ rawKey, nk: normalizeHeader(rawKey) }));
  const value = (rawKey) => (row[rawKey] ?? '').toString().trim();

  // 1. Coincidencia exacta
  for (const c of candidates) {
    const nc = normalizeHeader(c);
    const hit = keys.find(({ nk }) => nk === nc);
    if (hit) return value(hit.rawKey);
  }

  // 2. Coincidencia parcial
  for (const c of candidates) {
    const nc = normalizeHeader(c);
    const hit = keys.find(({ nk }) => nk.includes(nc));
    if (hit) return value(hit.rawKey);
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
        const liquidationNumber = col(row, 'LIQUIDACION', 'NUMERO LIQUIDACION', 'LIQ');

        // Ignorar filas vacías o de totales (sin número de liquidación)
        if (!liquidationNumber) {
          skipped++;
          continue;
        }

        const paymentDate       = parseArgDate(col(row, 'FECHA DE PAGO', 'PAGO'));
        const presentationDate  = parseArgDate(col(row, 'FECHA DE PRES', 'FECHA DE PRESENTACION', 'PRESENTACION'));
        const cardType          = col(row, 'TIPO', 'TARJETA', 'MARCA');
        const grossAmount       = parseArgAmount(col(row, 'MONTO BRUTO', 'TOTAL IMPORTE ACEPTADO', 'VENTAS C/DESCUENTO', 'BRUTO'));
        const netAmount         = parseArgAmount(col(row, 'NETO FINAL AL COMERCIO', 'IMPORTE NETO LIQ', 'IMPORTE NETO DE PAGOS', 'IMPORTE NETO PAGOS', 'TOTAL LIQUIDACION', 'NETO'));
        const arancelAmount     = parseArgAmount(col(row, 'ARANCELES + COSTOS FINAN', 'ARANCEL', 'DTO ARANCEL'), true);
        const ivaAmount         = parseArgAmount(col(row, 'IVA CRED. FISC. COMERCIOS', 'IVA CRED.FISC.COMERCIO', 'IVA CRED FISC', 'IVA'), true);
        const taxWithholding    = parseArgAmount(col(row, 'RETENCION IIBB', 'RETENCION ING.BRUTOS SIRTAC', 'SIRTAC', 'RETENCION ING BRUTOS'), true);
        const financialCost     = parseArgAmount(col(row, 'DESCUENTO DE FINANCIACION', 'DTO S/VENTAS FIN ADQ CONT', 'COSTO FINANCIERO'), true);

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

const uploadOffer = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen.' });
    }

    // 1. Optimizar con sharp → WebP
    const webpBuffer = await sharp(req.file.buffer)
      .resize({ width: 800, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    // 2. Subir al bucket 'offers' en Supabase Storage
    const fileName = `oferta_${Date.now()}.webp`;
    const { error: uploadError } = await supabase.storage
      .from('offers')
      .upload(fileName, webpBuffer, {
        contentType: 'image/webp',
        upsert: false,
      });

    if (uploadError) {
      console.error('Error al subir a Supabase Storage:', uploadError);
      return res.status(500).json({
        error: 'Error al subir la imagen al storage.',
        detalle: uploadError.message,
      });
    }

    // 3. Obtener URL pública
    const { data: urlData } = supabase.storage.from('offers').getPublicUrl(fileName);
    const imageUrl = urlData.publicUrl;

    // 4. Calcular order_index si no viene en el body
    let orderIndex = parseInt(req.body.order_index, 10);
    if (isNaN(orderIndex)) {
      const idxResult = await pool.query(
        'SELECT COALESCE(MAX(order_index), 0) + 1 AS next FROM public.store_offers'
      );
      orderIndex = idxResult.rows[0].next;
    }

    // 5. Registrar en base de datos
    const insertResult = await pool.query(
      `INSERT INTO public.store_offers (title, image_url, link_to_category, order_index)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        (req.body.title && req.body.title.trim()) || null,
        imageUrl,
        (req.body.link_to_category && req.body.link_to_category.trim()) || null,
        orderIndex,
      ]
    );

    return res.status(201).json({ success: true, offer: insertResult.rows[0] });
  } catch (err) {
    console.error('Error en uploadOffer:', err);
    return res.status(500).json({
      error: 'Error interno al procesar la imagen.',
      mensaje: err.message,
    });
  }
};

const getOffers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, image_url, link_to_category, order_index
       FROM public.store_offers
       WHERE is_active = TRUE
       ORDER BY order_index ASC`
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error al obtener ofertas:', err);
    return res.status(500).json({ error: 'Error al obtener las ofertas.' });
  }
};

const deleteOffer = async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'ID inválido' });

  try {
    const selectResult = await pool.query(
      'SELECT image_url FROM public.store_offers WHERE id = $1',
      [id]
    );
    if (selectResult.rowCount === 0) {
      return res.status(404).json({ error: 'Oferta no encontrada' });
    }

    const imageUrl = selectResult.rows[0].image_url;
    const fileName = imageUrl ? imageUrl.split('/').pop() : null;

    if (fileName) {
      const { error: storageError } = await supabase.storage
        .from('offers')
        .remove([fileName]);
      if (storageError) {
        console.warn('No se pudo eliminar del storage:', storageError.message);
      }
    }

    await pool.query('DELETE FROM public.store_offers WHERE id = $1', [id]);
    return res.status(200).json({ deleted: true, id });
  } catch (err) {
    console.error('Error al eliminar oferta:', err);
    return res.status(500).json({ error: 'Error interno al eliminar la oferta.' });
  }
};

const deleteAllOffers = async (req, res) => {
  try {
    const selectResult = await pool.query(
      'SELECT image_url FROM public.store_offers'
    );

    const fileNames = selectResult.rows
      .map((r) => r.image_url?.split('/').pop())
      .filter(Boolean);

    if (fileNames.length > 0) {
      const { error: storageError } = await supabase.storage
        .from('offers')
        .remove(fileNames);
      if (storageError) {
        console.warn('Error al eliminar archivos del storage:', storageError.message);
      }
    }

    await pool.query('DELETE FROM public.store_offers');
    return res.status(200).json({ deleted: true, count: selectResult.rowCount });
  } catch (err) {
    console.error('Error al eliminar todas las ofertas:', err);
    return res.status(500).json({ error: 'Error interno al eliminar las ofertas.' });
  }
};

module.exports = { uploadSettlements, getRecentSettlements, uploadOffer, getOffers, deleteOffer, deleteAllOffers };
