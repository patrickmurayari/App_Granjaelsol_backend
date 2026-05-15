const { Router } = require('express');
const { createEntry, getSupplierBalance, createPayment, getSuppliers, createSupplier, getEntriesBySupplier, getEntryDetails, updateItem, deleteItem, getPaymentsBySupplier } = require('../controllers/inventoryController');

const router = Router();

router.get('/suppliers', getSuppliers);
router.post('/suppliers', createSupplier);
router.post('/entries', createEntry);
router.get('/entries/supplier/:supplierId', getEntriesBySupplier);
router.get('/entries/:entryId/details', getEntryDetails);
router.put('/items/:itemId', updateItem);
router.delete('/items/:itemId', deleteItem);
router.get('/balance/:supplierId', getSupplierBalance);
router.post('/payments', createPayment);
router.get('/payments/supplier/:supplierId', getPaymentsBySupplier);

module.exports = router;
