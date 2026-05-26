const pool = require('../config/db');

const getCarousel = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, image_url, alt_text, order_index
       FROM carousel_images
       WHERE is_active = TRUE
       ORDER BY order_index ASC`
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error al obtener imágenes del carrusel:', err);
    return res.status(500).json({
      error: 'No se pudieron obtener las imágenes del carrusel',
      mensaje: 'Intenta nuevamente más tarde.',
    });
  }
};

module.exports = { getCarousel };
