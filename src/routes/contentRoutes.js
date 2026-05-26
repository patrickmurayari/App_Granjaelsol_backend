const { Router } = require('express');
const { getCarousel } = require('../controllers/contentController');

const router = Router();

router.get('/carousel', getCarousel);

module.exports = router;
