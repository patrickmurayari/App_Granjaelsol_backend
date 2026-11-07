const { Router } = require('express');
const {
  getBalanzaCodigos,
  createBalanzaCodigo,
  updateBalanzaCodigo,
  toggleActivo,
  toggleCategoria,
  deleteBalanzaCodigo,
} = require('../controllers/balanzaCodigosController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = Router();

router.get('/', requireAuth, getBalanzaCodigos);
router.post('/', requireAuth, createBalanzaCodigo);
router.patch('/toggle-categoria', requireAuth, toggleCategoria);
router.patch('/:id/toggle', requireAuth, toggleActivo);
router.put('/:id', requireAuth, updateBalanzaCodigo);
router.delete('/:id', requireAuth, deleteBalanzaCodigo);

module.exports = router;
