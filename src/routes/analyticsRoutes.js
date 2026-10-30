const { Router } = require('express');
const {
  getWeeklyPurchasesSummary, getMeatWeightsDistribution, getSupplierPurchasesShare,
  getFiservMonthlySummary, getFiservPaymentMethods, getCashflowComparison,
} = require('../controllers/analyticsController');

const router = Router();

router.get('/weekly-purchases', getWeeklyPurchasesSummary);
router.get('/weights-distribution', getMeatWeightsDistribution);
router.get('/suppliers-share', getSupplierPurchasesShare);
router.get('/fiserv-monthly', getFiservMonthlySummary);
router.get('/fiserv-payment-methods', getFiservPaymentMethods);
router.get('/cashflow', getCashflowComparison);

module.exports = router;
