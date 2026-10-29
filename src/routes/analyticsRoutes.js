const { Router } = require('express');
const { getWeeklyPurchasesSummary, getMeatWeightsDistribution, getSupplierPurchasesShare } = require('../controllers/analyticsController');

const router = Router();

router.get('/weekly-purchases', getWeeklyPurchasesSummary);
router.get('/weights-distribution', getMeatWeightsDistribution);
router.get('/suppliers-share', getSupplierPurchasesShare);

module.exports = router;
