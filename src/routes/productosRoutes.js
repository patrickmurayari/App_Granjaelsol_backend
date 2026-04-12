const { Router } = require('express');
const { getProductos, updateProducto, createProducto } = require('../controllers/productosController');

const router = Router();

router.get('/', getProductos);
router.put('/:id', updateProducto);
router.post('/', createProducto);

module.exports = router;
