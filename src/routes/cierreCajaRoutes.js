const { Router } = require('express');
const { getCierres, createOrUpdateCierre, updateCierre } = require('../controllers/cierreCajaController');

const router = Router();

router.get('/', getCierres);
router.post('/', createOrUpdateCierre);
router.put('/:id', updateCierre);

module.exports = router;
