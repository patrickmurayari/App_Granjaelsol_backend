const pool = require('../config/db');
const sharp = require('sharp');
const { supabase } = require('../config/supabase');

const getProductos = async (req, res) => {
  const { categoria } = req.query;

  try {
    let query = 'SELECT id, nombre, precio, stock, descripcion, categoria, imagen_url, peso_promedio_unidad, es_unidad, disponible FROM productos';
    const values = [];

    if (categoria && categoria !== 'Todas') {
      query += ' WHERE categoria = $1';
      values.push(categoria);
    }

    query += ' ORDER BY id ASC';

    const result = await pool.query(query, values);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error al consultar productos:', err);
    res.status(503).json({
      error: 'No se pudo conectar con la base de datos',
      mensaje: 'Intenta nuevamente más tarde'
    });
  }
};

const updateProducto = async (req, res) => {
  const { id } = req.params;
  const { precio, stock, nombre, descripcion, categoria, imagen_url, peso_promedio_unidad, es_unidad, disponible } = req.body || {};

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
    es_unidad,
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
};

const createProducto = async (req, res) => {
  const { nombre, precio, stock, descripcion, categoria, imagen_url, peso_promedio_unidad, es_unidad } = req.body || {};

  if (!nombre || nombre.trim() === '') {
    return res.status(400).json({ error: 'El nombre del producto es obligatorio' });
  }

  let finalImageUrl = imagen_url?.trim() || null;

  if (req.file) {
    try {
      const webpBuffer = await sharp(req.file.buffer)
        .resize({ width: 800, height: 800, fit: 'cover', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      const fileName = `producto_${Date.now()}.webp`;
      const { error: uploadError } = await supabase.storage
        .from('imagenes-productos')
        .upload(fileName, webpBuffer, { contentType: 'image/webp', upsert: false });

      if (uploadError) {
        console.error('Error al subir imagen del producto:', uploadError);
        return res.status(500).json({
          error: 'Error al subir la imagen del producto.',
          detalle: uploadError.message,
        });
      }

      const { data: urlData } = supabase.storage
        .from('imagenes-productos')
        .getPublicUrl(fileName);
      finalImageUrl = urlData.publicUrl;
    } catch (sharpErr) {
      console.error('Error al procesar imagen:', sharpErr);
      return res.status(500).json({ error: 'Error al procesar la imagen.' });
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO productos (nombre, precio, stock, descripcion, categoria, imagen_url, peso_promedio_unidad, es_unidad)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        nombre.trim(),
        precio === '' ? null : Number(precio) || null,
        stock === '' ? null : Number(stock) || null,
        descripcion?.trim() || null,
        categoria?.trim() || null,
        finalImageUrl,
        peso_promedio_unidad === '' ? null : Number(peso_promedio_unidad) || null,
        es_unidad === true || es_unidad === 'true',
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
};

const deleteProducto = async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'ID inválido' });

  try {
    const result = await pool.query(
      'DELETE FROM productos WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    return res.status(200).json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Error al eliminar producto:', err);
    return res.status(503).json({
      error: 'No se pudo eliminar el producto',
      mensaje: 'Intenta nuevamente más tarde',
    });
  }
};

module.exports = {
  getProductos,
  updateProducto,
  createProducto,
  deleteProducto,
};
