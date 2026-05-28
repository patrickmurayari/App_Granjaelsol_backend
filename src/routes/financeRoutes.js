const { Router } = require('express');
const multer = require('multer');
const { uploadSettlements, getRecentSettlements } = require('../controllers/financeController');

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

const router = Router();

router.post('/settlements/upload', upload.single('file'), uploadSettlements);
router.get('/settlements/recent', getRecentSettlements);

module.exports = router;
