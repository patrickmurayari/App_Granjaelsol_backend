const pool = require('../config/db');

const createEntry = async (req, res) => {
  const { supplier_id, invoice_number, entry_date, items, iva_21, percepcion_iva, percepcion_iibb, is_adjustment, adjustment_notes, total_debe } = req.body || {};

  const isAdj = is_adjustment === true;

  // ── Validaciones ──
  if (!supplier_id) {
    return res.status(400).json({ error: 'supplier_id es obligatorio' });
  }

  if (isAdj) {
    // Ajuste: no requiere items, pero sí un monto
    if (total_debe == null || Number(total_debe) === 0) {
      return res.status(400).json({ error: 'total_debe es obligatorio y distinto de 0 para ajustes' });
    }
  } else {
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items debe ser un array con al menos un producto' });
    }

    const validUnitTypes = ['kg', 'u'];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.product_name) {
        return res.status(400).json({ error: `items[${i}].product_name es obligatorio` });
      }
      const ut = (item.unit_type || 'kg').toLowerCase().trim();
      if (!validUnitTypes.includes(ut)) {
        return res.status(400).json({ error: `items[${i}].unit_type debe ser 'kg' o 'u'` });
      }
      if (ut === 'kg' && (!Array.isArray(item.weights) || item.weights.length === 0)) {
        return res.status(400).json({ error: `items[${i}].weights debe ser un array con al menos un peso (unit_type=kg)` });
      }
      if (ut === 'u' && (item.quantity == null || Number(item.quantity) <= 0)) {
        return res.status(400).json({ error: `items[${i}].quantity debe ser un número positivo (unit_type=u)` });
      }
      if (item.unit_price == null || Number(item.unit_price) <= 0) {
        return res.status(400).json({ error: `items[${i}].unit_price debe ser un número positivo` });
      }
    }
  }

  const invoiceNumber = invoice_number?.trim() || null;
  const entryDate = entry_date || new Date().toISOString().split('T')[0];

  // ── Transacción ──
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (isAdj) {
      // ── Ajuste de saldo ──
      const adjTotal = Math.round(Number(total_debe) * 100) / 100;
      const entryResult = await client.query(
        `INSERT INTO merchandise_entries (supplier_id, invoice_number, entry_date, subtotal_neto, iva_21, percepcion_iva, percepcion_iibb, total_debe, is_adjustment, adjustment_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, supplier_id, invoice_number, entry_date, subtotal_neto, iva_21, percepcion_iva, percepcion_iibb, total_debe, is_adjustment, adjustment_notes, created_at`,
        [supplier_id, invoiceNumber, entryDate, adjTotal, 0, 0, 0, adjTotal, true, adjustment_notes?.trim() || null]
      );

      await client.query('COMMIT');

      return res.status(201).json({
        entry: entryResult.rows[0],
        items: [],
      });
    }

    // ── Remito normal ──
    const processedItems = items.map((item) => {
      const unitType = (item.unit_type || 'kg').toLowerCase().trim();
      let weights;
      if (unitType === 'u') {
        weights = [Number(item.quantity)];
      } else {
        weights = item.weights.map(Number);
      }
      const totalQty = weights.reduce((sum, w) => sum + Number(w), 0);
      const unitPrice = Number(item.unit_price);
      const totalItem = Math.round(totalQty * unitPrice * 100) / 100;
      return {
        product_name: item.product_name.trim(),
        weights,
        unit_type: unitType,
        unit_price: unitPrice,
        total_item: totalItem,
      };
    });

    const subtotalNeto = Math.round(
      processedItems.reduce((sum, item) => sum + item.total_item, 0) * 100
    ) / 100;

    const parsedIva21 = Math.round(Number(iva_21 || 0) * 100) / 100;
    const parsedPercepcionIva = Math.round(Number(percepcion_iva || 0) * 100) / 100;
    const parsedPercepcionIibb = Math.round(Number(percepcion_iibb || 0) * 100) / 100;

    const totalDebeCalc = Math.round(
      (subtotalNeto + parsedIva21 + parsedPercepcionIva + parsedPercepcionIibb) * 100
    ) / 100;

    // Insertar cabecera
    const entryResult = await client.query(
      `INSERT INTO merchandise_entries (supplier_id, invoice_number, entry_date, subtotal_neto, iva_21, percepcion_iva, percepcion_iibb, total_debe, is_adjustment, adjustment_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, supplier_id, invoice_number, entry_date, subtotal_neto, iva_21, percepcion_iva, percepcion_iibb, total_debe, is_adjustment, adjustment_notes, created_at`,
      [supplier_id, invoiceNumber, entryDate, subtotalNeto, parsedIva21, parsedPercepcionIva, parsedPercepcionIibb, totalDebeCalc, false, null]
    );

    const entryId = entryResult.rows[0].id;

    // Insertar items
    const insertedItems = [];
    for (const item of processedItems) {
      const itemResult = await client.query(
        `INSERT INTO merchandise_items (entry_id, product_name, weights, unit_type, unit_price, total_item)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, entry_id, product_name, weights, unit_type, unit_price, total_item`,
        [entryId, item.product_name, item.weights, item.unit_type, item.unit_price, item.total_item]
      );
      insertedItems.push(itemResult.rows[0]);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      entry: entryResult.rows[0],
      items: insertedItems,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en transacción de entrada de mercadería:', err);
    return res.status(500).json({
      error: 'No se pudo registrar la entrada de mercadería',
      mensaje: 'La transacción fue revertida. Intenta nuevamente.',
    });
  } finally {
    client.release();
  }
};

// ── GET /api/inventory/balance/:supplierId ──
const getSupplierBalance = async (req, res) => {
  const { supplierId } = req.params;

  if (!supplierId) {
    return res.status(400).json({ error: 'supplierId es obligatorio' });
  }

  try {
    // Verificar que el proveedor existe
    const supplierResult = await pool.query(
      'SELECT id, name, category FROM suppliers WHERE id = $1',
      [supplierId]
    );

    if (supplierResult.rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }

    const supplier = supplierResult.rows[0];

    // Sumatoria de total_debe (entradas de mercadería)
    const debeResult = await pool.query(
      'SELECT COALESCE(SUM(total_debe), 0) AS total_debe FROM merchandise_entries WHERE supplier_id = $1',
      [supplierId]
    );

    // Sumatoria de amount_haber (pagos realizados)
    const haberResult = await pool.query(
      'SELECT COALESCE(SUM(amount_haber), 0) AS total_haber FROM supplier_payments WHERE supplier_id = $1',
      [supplierId]
    );

    const totalDebe = Number(debeResult.rows[0].total_debe);
    const totalHaber = Number(haberResult.rows[0].total_haber);
    const saldo = Math.round((totalDebe - totalHaber) * 100) / 100;

    return res.status(200).json({
      supplier: {
        id: supplier.id,
        name: supplier.name,
        category: supplier.category,
      },
      total_debe: totalDebe,
      total_haber: totalHaber,
      saldo_pendiente: saldo,
    });
  } catch (err) {
    console.error('Error al calcular saldo del proveedor:', err);
    return res.status(500).json({
      error: 'No se pudo calcular el saldo del proveedor',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  }
};

// ── GET /api/inventory/payments/supplier/:supplierId ──
const getPaymentsBySupplier = async (req, res) => {
  const { supplierId } = req.params;

  if (!supplierId) {
    return res.status(400).json({ error: 'supplierId es obligatorio' });
  }

  try {
    const result = await pool.query(
      `SELECT id, supplier_id, payment_date, method, amount_haber, created_at
       FROM supplier_payments
       WHERE supplier_id = $1
       ORDER BY payment_date DESC, created_at DESC`,
      [supplierId]
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error al consultar pagos del proveedor:', err);
    return res.status(500).json({
      error: 'No se pudo consultar los pagos',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  }
};

// ── POST /api/inventory/payments ──
const createPayment = async (req, res) => {
  const { supplier_id, payment_date, method, amount_haber } = req.body || {};

  // ── Validaciones ──
  if (!supplier_id) {
    return res.status(400).json({ error: 'supplier_id es obligatorio' });
  }
  if (!amount_haber || Number(amount_haber) <= 0) {
    return res.status(400).json({ error: 'amount_haber debe ser un número positivo' });
  }

  const validMethods = ['efectivo', 'transferencia', 'posnet', 'cheque'];
  const paymentMethod = (method || 'efectivo').toLowerCase().trim();
  if (!validMethods.includes(paymentMethod)) {
    return res.status(400).json({
      error: `method debe ser uno de: ${validMethods.join(', ')}`,
    });
  }

  const amount = Math.round(Number(amount_haber) * 100) / 100;
  const payDate = payment_date || new Date().toISOString().split('T')[0];

  try {
    // Verificar que el proveedor existe
    const supplierResult = await pool.query(
      'SELECT id FROM suppliers WHERE id = $1',
      [supplier_id]
    );

    if (supplierResult.rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }

    const result = await pool.query(
      `INSERT INTO supplier_payments (supplier_id, payment_date, method, amount_haber)
       VALUES ($1, $2, $3, $4)
       RETURNING id, supplier_id, payment_date, method, amount_haber, created_at`,
      [supplier_id, payDate, paymentMethod, amount]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al registrar pago:', err);
    return res.status(500).json({
      error: 'No se pudo registrar el pago',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  }
};

// ── PUT /api/inventory/payments/:paymentId ──
const updatePayment = async (req, res) => {
  const { paymentId } = req.params;
  const { amount_haber, payment_date, method } = req.body || {};

  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId es obligatorio' });
  }

  if (amount_haber !== undefined && (Number(amount_haber) <= 0 || isNaN(Number(amount_haber)))) {
    return res.status(400).json({ error: 'amount_haber debe ser un número positivo mayor a cero' });
  }

  const validMethods = ['efectivo', 'transferencia'];
  if (method !== undefined) {
    const m = method.toLowerCase().trim();
    if (!validMethods.includes(m)) {
      return res.status(400).json({ error: `method debe ser uno de: ${validMethods.join(', ')}` });
    }
  }

  try {
    const existing = await pool.query('SELECT id FROM supplier_payments WHERE id = $1', [paymentId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (amount_haber !== undefined) {
      fields.push(`amount_haber = $${idx++}`);
      values.push(Math.round(Number(amount_haber) * 100) / 100);
    }
    if (payment_date !== undefined) {
      fields.push(`payment_date = $${idx++}`);
      values.push(payment_date);
    }
    if (method !== undefined) {
      fields.push(`method = $${idx++}`);
      values.push(method.toLowerCase().trim());
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos para actualizar' });
    }

    values.push(paymentId);
    const result = await pool.query(
      `UPDATE supplier_payments SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, supplier_id, payment_date, method, amount_haber, created_at`,
      values
    );

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error al actualizar pago:', err);
    return res.status(500).json({ error: 'No se pudo actualizar el pago' });
  }
};

// ── DELETE /api/inventory/payments/:paymentId ──
const deletePayment = async (req, res) => {
  const { paymentId } = req.params;

  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId es obligatorio' });
  }

  try {
    const existing = await pool.query('SELECT id FROM supplier_payments WHERE id = $1', [paymentId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    await pool.query('DELETE FROM supplier_payments WHERE id = $1', [paymentId]);
    return res.status(200).json({ message: 'Pago eliminado correctamente' });
  } catch (err) {
    console.error('Error al eliminar pago:', err);
    return res.status(500).json({ error: 'No se pudo eliminar el pago' });
  }
};

// ── GET /api/inventory/suppliers ──
const getSuppliers = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, category FROM suppliers ORDER BY name ASC'
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error al consultar proveedores:', err);
    return res.status(500).json({
      error: 'No se pudo consultar los proveedores',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  }
};

// ── POST /api/inventory/suppliers ──
const createSupplier = async (req, res) => {
  const { name, category } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name es obligatorio' });
  }

  const validCategories = ['Carne', 'Pollo', 'Cerdo', 'Achuras', 'Pescado', 'Almacén'];
  const supplierCategory = (category || 'Carne').trim();
  if (!validCategories.includes(supplierCategory)) {
    return res.status(400).json({
      error: `category debe ser uno de: ${validCategories.join(', ')}`,
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO suppliers (name, category)
       VALUES ($1, $2)
       RETURNING id, name, category`,
      [name.trim(), supplierCategory]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear proveedor:', err);
    return res.status(500).json({
      error: 'No se pudo crear el proveedor',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  }
};

// ── GET /api/inventory/entries/supplier/:supplierId ──
const getEntriesBySupplier = async (req, res) => {
  const { supplierId } = req.params;

  if (!supplierId) {
    return res.status(400).json({ error: 'supplierId es obligatorio' });
  }

  try {
    const result = await pool.query(
      `SELECT id, supplier_id, invoice_number, entry_date, subtotal_neto, iva_21, percepcion_iva, percepcion_iibb, total_debe, is_adjustment, adjustment_notes, created_at
       FROM merchandise_entries
       WHERE supplier_id = $1
       ORDER BY entry_date DESC, created_at DESC`,
      [supplierId]
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error al consultar remitos del proveedor:', err);
    return res.status(500).json({
      error: 'No se pudo consultar los remitos',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  }
};

// ── GET /api/inventory/entries/:entryId/details ──
const getEntryDetails = async (req, res) => {
  const { entryId } = req.params;

  if (!entryId) {
    return res.status(400).json({ error: 'entryId es obligatorio' });
  }

  try {
    const entryResult = await pool.query(
      `SELECT id, supplier_id, invoice_number, entry_date, subtotal_neto, iva_21, percepcion_iva, percepcion_iibb, total_debe, is_adjustment, adjustment_notes, created_at
       FROM merchandise_entries
       WHERE id = $1`,
      [entryId]
    );

    if (entryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Remito no encontrado' });
    }

    const itemsResult = await pool.query(
      `SELECT id, entry_id, product_name, weights, unit_type, unit_price, total_item
       FROM merchandise_items
       WHERE entry_id = $1
       ORDER BY id ASC`,
      [entryId]
    );

    return res.status(200).json({
      entry: entryResult.rows[0],
      items: itemsResult.rows,
    });
  } catch (err) {
    console.error('Error al consultar detalle del remito:', err);
    return res.status(500).json({
      error: 'No se pudo consultar el detalle del remito',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  }
};

// ── PUT /api/inventory/items/:itemId ──
const updateItem = async (req, res) => {
  const { itemId } = req.params;
  const { product_name, weights, unit_price, unit_type, quantity } = req.body || {};

  if (!itemId) {
    return res.status(400).json({ error: 'itemId es obligatorio' });
  }
  if (!product_name || !product_name.trim()) {
    return res.status(400).json({ error: 'product_name es obligatorio' });
  }

  const validUnitTypes = ['kg', 'u'];
  const ut = (unit_type || 'kg').toLowerCase().trim();
  if (!validUnitTypes.includes(ut)) {
    return res.status(400).json({ error: "unit_type debe ser 'kg' o 'u'" });
  }

  let resolvedWeights;
  if (ut === 'u') {
    if (quantity == null || Number(quantity) <= 0) {
      return res.status(400).json({ error: 'quantity debe ser un número positivo (unit_type=u)' });
    }
    resolvedWeights = [Number(quantity)];
  } else {
    if (!Array.isArray(weights) || weights.length === 0) {
      return res.status(400).json({ error: 'weights debe ser un array con al menos un peso (unit_type=kg)' });
    }
    resolvedWeights = weights.map(Number);
  }

  if (unit_price == null || Number(unit_price) <= 0) {
    return res.status(400).json({ error: 'unit_price debe ser un número positivo' });
  }

  const totalQty = resolvedWeights.reduce((sum, w) => sum + Number(w), 0);
  const parsedPrice = Number(unit_price);
  const totalItem = Math.round(totalQty * parsedPrice * 100) / 100;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verificar que el item existe y obtener entry_id
    const itemCheck = await client.query(
      'SELECT id, entry_id FROM merchandise_items WHERE id = $1',
      [itemId]
    );
    if (itemCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item no encontrado' });
    }

    const entryId = itemCheck.rows[0].entry_id;

    // Actualizar item
    const itemResult = await client.query(
      `UPDATE merchandise_items
       SET product_name = $1, weights = $2, unit_type = $3, unit_price = $4, total_item = $5
       WHERE id = $6
       RETURNING id, entry_id, product_name, weights, unit_type, unit_price, total_item`,
      [product_name.trim(), resolvedWeights, ut, parsedPrice, totalItem, itemId]
    );

    // Recalcular subtotal_neto y total_debe de la cabecera
    const sumResult = await client.query(
      'SELECT COALESCE(SUM(total_item), 0) AS new_subtotal FROM merchandise_items WHERE entry_id = $1',
      [entryId]
    );
    const newSubtotalNeto = Math.round(Number(sumResult.rows[0].new_subtotal) * 100) / 100;

    // Obtener impuestos existentes de la cabecera
    const taxResult = await client.query(
      'SELECT COALESCE(iva_21, 0) AS iva_21, COALESCE(percepcion_iva, 0) AS percepcion_iva, COALESCE(percepcion_iibb, 0) AS percepcion_iibb FROM merchandise_entries WHERE id = $1',
      [entryId]
    );
    const taxes = taxResult.rows[0];
    const newTotalDebe = Math.round(
      (newSubtotalNeto + Number(taxes.iva_21) + Number(taxes.percepcion_iva) + Number(taxes.percepcion_iibb)) * 100
    ) / 100;

    await client.query(
      'UPDATE merchandise_entries SET subtotal_neto = $1, total_debe = $2 WHERE id = $3',
      [newSubtotalNeto, newTotalDebe, entryId]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      item: itemResult.rows[0],
      entry_subtotal_neto: newSubtotalNeto,
      entry_total_debe: newTotalDebe,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al actualizar item:', err);
    return res.status(500).json({
      error: 'No se pudo actualizar el item',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  } finally {
    client.release();
  }
};

// ── DELETE /api/inventory/items/:itemId ──
const deleteItem = async (req, res) => {
  const { itemId } = req.params;

  if (!itemId) {
    return res.status(400).json({ error: 'itemId es obligatorio' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verificar que el item existe y obtener entry_id
    const itemCheck = await client.query(
      'SELECT id, entry_id FROM merchandise_items WHERE id = $1',
      [itemId]
    );
    if (itemCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item no encontrado' });
    }

    const entryId = itemCheck.rows[0].entry_id;

    // Eliminar item
    await client.query('DELETE FROM merchandise_items WHERE id = $1', [itemId]);

    // Recalcular subtotal_neto y total_debe de la cabecera
    const sumResult = await client.query(
      'SELECT COALESCE(SUM(total_item), 0) AS new_subtotal FROM merchandise_items WHERE entry_id = $1',
      [entryId]
    );
    const newSubtotalNeto = Math.round(Number(sumResult.rows[0].new_subtotal) * 100) / 100;

    // Obtener impuestos existentes de la cabecera
    const taxResult = await client.query(
      'SELECT COALESCE(iva_21, 0) AS iva_21, COALESCE(percepcion_iva, 0) AS percepcion_iva, COALESCE(percepcion_iibb, 0) AS percepcion_iibb FROM merchandise_entries WHERE id = $1',
      [entryId]
    );
    const taxes = taxResult.rows[0];
    const newTotalDebe = Math.round(
      (newSubtotalNeto + Number(taxes.iva_21) + Number(taxes.percepcion_iva) + Number(taxes.percepcion_iibb)) * 100
    ) / 100;

    await client.query(
      'UPDATE merchandise_entries SET subtotal_neto = $1, total_debe = $2 WHERE id = $3',
      [newSubtotalNeto, newTotalDebe, entryId]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      deleted: true,
      entry_id: entryId,
      entry_subtotal_neto: newSubtotalNeto,
      entry_total_debe: newTotalDebe,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al eliminar item:', err);
    return res.status(500).json({
      error: 'No se pudo eliminar el item',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  } finally {
    client.release();
  }
};

// ── DELETE /api/inventory/entries/:entryId ──
const deleteEntry = async (req, res) => {
  const { entryId } = req.params;

  if (!entryId) {
    return res.status(400).json({ error: 'entryId es obligatorio' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verificar que la entrada existe
    const entryCheck = await client.query(
      'SELECT id, supplier_id FROM merchandise_entries WHERE id = $1',
      [entryId]
    );
    if (entryCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Remito no encontrado' });
    }

    // Eliminar items asociados
    await client.query('DELETE FROM merchandise_items WHERE entry_id = $1', [entryId]);

    // Eliminar la cabecera
    await client.query('DELETE FROM merchandise_entries WHERE id = $1', [entryId]);

    await client.query('COMMIT');

    return res.status(200).json({
      deleted: true,
      entry_id: Number(entryId),
      supplier_id: entryCheck.rows[0].supplier_id,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al eliminar remito:', err);
    return res.status(500).json({
      error: 'No se pudo eliminar el remito',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  } finally {
    client.release();
  }
};

module.exports = {
  createEntry,
  getSupplierBalance,
  createPayment,
  getSuppliers,
  createSupplier,
  getEntriesBySupplier,
  getEntryDetails,
  updateItem,
  deleteItem,
  deleteEntry,
  getPaymentsBySupplier,
  updatePayment,
  deletePayment,
};
