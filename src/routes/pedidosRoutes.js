const { Router } = require('express');
const { createPedido, getPedidos, updatePedidoEstado } = require('../controllers/pedidosController');

const router = Router();

router.post('/', createPedido);
router.get('/', getPedidos);
router.put('/:id', updatePedidoEstado);

module.exports = router;
