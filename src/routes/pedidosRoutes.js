const { Router } = require('express');
const { createPedido, getPedidos, updatePedidoEstado } = require('../controllers/pedidosController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = Router();

router.post('/', createPedido);
router.get('/', requireAuth, getPedidos);
router.put('/:id', requireAuth, updatePedidoEstado);

module.exports = router;
