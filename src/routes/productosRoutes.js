const { Router } = require('express');
const multer = require('multer');
const { getProductos, updateProducto, createProducto, deleteProducto } = require('../controllers/productosController');
const { requireAuth } = require('../middleware/authMiddleware');

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se aceptan archivos de imagen'));
    }
  },
});

const router = Router();

router.get('/', getProductos);
router.put('/:id', requireAuth, updateProducto);
router.post('/', requireAuth, imageUpload.single('image'), createProducto);
router.delete('/:id', requireAuth, deleteProducto);

module.exports = router;
