const express = require('express');
const InkDoc = require('./model');
const { upload } = require('./upload');
const aiRoutes = require('./ai');

const router = express.Router();

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const MARKS_ID = 'important-marks';

router.use('/ai', aiRoutes);

router.get('/health', (req, res) => {
  res.json({ ok: true });
});

router.get(
  '/state',
  wrap(async (req, res) => {
    const [subjects, marksDoc] = await Promise.all([
      InkDoc.find({ kind: 'subject' }).sort({ position: 1 }).lean(),
      InkDoc.findById(MARKS_ID).lean(),
    ]);
    res.json({
      subjects: subjects.map(({ kind, createdAt, updatedAt, __v, ...subject }) => subject),
      important: (marksDoc && marksDoc.marks) || [],
    });
  })
);

router.put(
  '/state',
  wrap(async (req, res) => {
    const { subjects, important } = req.body ?? {};
    if (!Array.isArray(subjects) || !Array.isArray(important)) {
      return res.status(400).json({ error: 'Body must be { subjects: [], important: [] }' });
    }
    for (const subject of subjects) {
      if (!subject || typeof subject._id !== 'string' || !subject._id) {
        return res.status(400).json({ error: 'Every subject needs a string _id' });
      }
    }

    const keepIds = subjects.map((s) => s._id);
    const ops = subjects.map((subject, index) => ({
      replaceOne: {
        filter: { _id: subject._id },
        replacement: { ...subject, kind: 'subject', position: index },
        upsert: true,
      },
    }));
    ops.push({
      deleteMany: { filter: { kind: 'subject', _id: { $nin: keepIds } } },
    });
    ops.push({
      replaceOne: {
        filter: { _id: MARKS_ID },
        replacement: { _id: MARKS_ID, kind: 'important-marks', marks: important },
        upsert: true,
      },
    });

    await InkDoc.bulkWrite(ops, { ordered: true });
    res.json({ ok: true, savedAt: new Date().toISOString() });
  })
);

router.post('/uploads', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided (field name: file)' });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

module.exports = router;
