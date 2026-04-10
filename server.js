require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const express = require('express');
const cors = require('cors');

const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Ruta básica para verificar que el servidor está escuchando
app.get('/', (req, res) => {
  res.status(200).json({
    mensaje: '¡Servidor de Granja El Sol está funcionando correctamente!',
    estado: 'activo',
    timestamp: new Date().toISOString()
  });
});

// Ruta de salud (health check)
app.get('/health', (req, res) => {
  res.status(200).json({
    estado: 'ok',
    servidor: 'Granja El Sol Backend',
    puerto: PORT
  });
});

// Productos
app.get('/api/productos', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nombre, precio, stock, descripcion, categoria, imagen_url, peso_promedio_unidad, disponible FROM productos'
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error al consultar productos:', err);
    res.status(503).json({
      error: 'No se pudo conectar con la base de datos',
      mensaje: 'Intenta nuevamente más tarde'
    });
  }
});

// Actualizar producto (precio y/o otros campos)
app.put('/api/productos/:id', async (req, res) => {
  const { id } = req.params;
  const { precio, stock, nombre, descripcion, categoria, imagen_url, peso_promedio_unidad, disponible } = req.body || {};

  const setParts = [];
  const values = [];

  const allowedFields = {
    precio,
    stock,
    nombre,
    descripcion,
    categoria,
    imagen_url,
    peso_promedio_unidad,
    disponible,
  };

  for (const [field, value] of Object.entries(allowedFields)) {
    if (value !== undefined) {
      values.push(value);
      setParts.push(`${field} = $${values.length}`);
    }
  }

  if (!id) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  if (setParts.length === 0) {
    return res.status(400).json({
      error: 'No se enviaron campos para actualizar',
      mensaje: 'Envía al menos precio, stock, nombre, descripcion, categoria o imagen_url'
    });
  }

  values.push(id);
  const query = `UPDATE productos SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`;

  try {
    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error al actualizar producto:', err);
    return res.status(503).json({
      error: 'No se pudo actualizar el producto',
      mensaje: 'Intenta nuevamente más tarde'
    });
  }
});

// Crear nuevo producto
app.post('/api/productos', async (req, res) => {
  const { nombre, precio, stock, descripcion, categoria, imagen_url, peso_promedio_unidad } = req.body || {};

  if (!nombre || nombre.trim() === '') {
    return res.status(400).json({ error: 'El nombre del producto es obligatorio' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO productos (nombre, precio, stock, descripcion, categoria, imagen_url, peso_promedio_unidad)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        nombre.trim(),
        precio === '' ? null : Number(precio) || null,
        stock === '' ? null : Number(stock) || null,
        descripcion?.trim() || null,
        categoria?.trim() || null,
        imagen_url?.trim() || null,
        peso_promedio_unidad === '' ? null : Number(peso_promedio_unidad) || null,
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear producto:', err);
    return res.status(503).json({
      error: 'No se pudo crear el producto',
      mensaje: 'Intenta nuevamente más tarde'
    });
  }
});

// Registrar pedido
app.post('/api/pedidos', async (req, res) => {
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
});

// Obtener todos los pedidos
app.get('/api/pedidos', async (req, res) => {
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
});

// Actualizar estado de pedido
app.put('/api/pedidos/:id', async (req, res) => {
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
});

// Obtener cierres de caja
app.get('/api/cierres', async (req, res) => {
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
});

app.post('/api/cierres', async (req, res) => {
  const {
    venta_total_balanza,
    venta_posnet,
    venta_transferencias,
    fondo_inicial,
    efectivo_final,
    gastos_del_dia,
    notas
  } = req.body || {};

  // Validar y convertir campos numéricos
  const ventaBalanza = Number(venta_total_balanza) || 0;
  const posnet = Number(venta_posnet) || 0;
  const transferencias = Number(venta_transferencias) || 0;
  const fondoInicial = Number(fondo_inicial) || 0;
  const efectivoFinal = Number(efectivo_final) || 0;
  const gastos = Number(gastos_del_dia) || 0;
  const notasStr = notas?.trim() || null;

  // Obtener fecha actual (solo día, sin hora)
  const hoy = new Date().toISOString().split('T')[0];

  try {
    // Verificar si ya existe cierre para hoy
    const existingResult = await pool.query(
      'SELECT id FROM cierres_caja WHERE fecha = $1',
      [hoy]
    );

    let result;

    if (existingResult.rows.length > 0) {
      // Actualizar cierre existente (diferencia_caja se calcula en DB)
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
      // Crear nuevo cierre (diferencia_caja se calcula automáticamente en DB)
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
});

// Actualizar cierre de caja por ID
app.put('/api/cierres/:id', async (req, res) => {
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

  // Validar y convertir campos numéricos
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
    // diferencia_caja se calcula automáticamente en la base de datos
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
});

// Manejo de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    ruta: req.originalUrl
  });
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Error interno del servidor',
    mensaje: err.message
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`? Servidor de Granja El Sol escuchando en puerto ${PORT}`);
  console.log(`? Accede a: http://localhost:${PORT}`);
});

module.exports = app;