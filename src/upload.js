const multer = require('multer');

// Images are held in memory only (never written to server disk) and pushed
// straight to ImageKit by the route handlers.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
    cb(Object.assign(new Error('Only image uploads are allowed'), { status: 400 }));
  },
});

module.exports = { upload };
