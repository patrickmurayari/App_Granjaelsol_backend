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
 app.get('/api/productos', async (req, res, next) => {
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
  console.log(`🚀 Servidor de Granja El Sol escuchando en puerto ${PORT}`);
  console.log(`📍 Accede a: http://localhost:${PORT}`);
});


module.exports = app;