const { Router } = require('express');
const { createEntry, getSupplierBalance, createPayment, getSuppliers, createSupplier, getEntriesBySupplier, getEntryDetails, updateItem, deleteItem, deleteEntry, getPaymentsBySupplier, updatePayment, deletePayment, getStatement } = require('../controllers/inventoryController');

const router = Router();

router.get('/suppliers', getSuppliers);
router.post('/suppliers', createSupplier);
router.post('/entries', createEntry);
router.get('/entries/supplier/:supplierId', getEntriesBySupplier);
router.get('/entries/:entryId/details', getEntryDetails);
router.delete('/entries/:entryId', deleteEntry);
router.put('/items/:itemId', updateItem);
router.delete('/items/:itemId', deleteItem);
router.get('/suppliers/:supplierId/statement', getStatement);
router.get('/balance/:supplierId', getSupplierBalance);
router.post('/payments', createPayment);
router.get('/payments/supplier/:supplierId', getPaymentsBySupplier);
router.put('/payments/:paymentId', updatePayment);
router.delete('/payments/:paymentId', deletePayment);

module.exports = router;
