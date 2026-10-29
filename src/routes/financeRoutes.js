const { Router } = require('express');
const multer = require('multer');
const { uploadSettlements, getRecentSettlements, uploadOffer, getOffers, deleteOffer, deleteAllOffers } = require('../controllers/financeController');
const { requireAuth } = require('../middleware/authMiddleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const isCSV =
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/octet-stream' ||
      file.originalname.toLowerCase().endsWith('.csv');

    if (isCSV) {
      cb(null, true);
    } else {
      cb(new Error('Solo se aceptan archivos con extensión .csv'));
    }
  },
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se aceptan archivos de imagen (JPG, PNG, WEBP, etc.)'));
    }
  },
});

const router = Router();

router.post('/settlements/upload', requireAuth, upload.single('file'), uploadSettlements);
router.get('/settlements/recent', requireAuth, getRecentSettlements);
router.post('/offers/upload', requireAuth, imageUpload.single('image'), uploadOffer);
router.get('/offers', getOffers);
router.delete('/offers/:id', requireAuth, deleteOffer);
router.delete('/offers', requireAuth, deleteAllOffers);

module.exports = router;
