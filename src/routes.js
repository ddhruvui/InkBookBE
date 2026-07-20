const express = require('express');
const InkDoc = require('./model');
const { upload } = require('./upload');
const imagekit = require('./imagekit');
const aiRoutes = require('./ai');

const router = express.Router();

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const MARKS_ID = 'important-marks';
const META_ID = 'state-meta';

// Monotonic save counter. Clients send back the version they loaded so a
// stale client (e.g. a phone/laptop tab opened before edits elsewhere) gets a
// 409 instead of silently overwriting newer data with its old snapshot.
async function currentVersion() {
  const meta = await InkDoc.findById(META_ID).lean();
  return (meta && meta.version) || 0;
}

router.use('/ai', aiRoutes);

router.get('/health', (req, res) => {
  res.json({ ok: true });
});

router.get(
  '/state',
  wrap(async (req, res) => {
    const [subjects, marksDoc, version] = await Promise.all([
      InkDoc.find({ kind: 'subject' }).sort({ position: 1 }).lean(),
      InkDoc.findById(MARKS_ID).lean(),
      currentVersion(),
    ]);
    res.json({
      subjects: subjects.map(({ kind, createdAt, updatedAt, __v, ...subject }) => subject),
      important: (marksDoc && marksDoc.marks) || [],
      version,
    });
  })
);

router.put(
  '/state',
  wrap(async (req, res) => {
    const { subjects, important, baseVersion } = req.body ?? {};
    if (!Array.isArray(subjects) || !Array.isArray(important)) {
      return res.status(400).json({ error: 'Body must be { subjects: [], important: [] }' });
    }
    for (const subject of subjects) {
      if (!subject || typeof subject._id !== 'string' || !subject._id) {
        return res.status(400).json({ error: 'Every subject needs a string _id' });
      }
    }

    const version = await currentVersion();
    if (typeof baseVersion === 'number' && baseVersion !== version) {
      return res.status(409).json({
        error: 'Notes were changed from another device since this one loaded.',
        version,
      });
    }
    // A client that failed to load starts with an empty notebook; never let
    // that snapshot erase real data.
    if (!subjects.length && (await InkDoc.countDocuments({ kind: 'subject' })) > 0) {
      return res.status(409).json({
        error: 'Refusing to erase all notes — reload to get the latest data first.',
        version,
      });
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
    ops.push({
      replaceOne: {
        filter: { _id: META_ID },
        replacement: { _id: META_ID, kind: 'state-meta', version: version + 1 },
        upsert: true,
      },
    });

    await InkDoc.bulkWrite(ops, { ordered: true });
    res.json({ ok: true, savedAt: new Date().toISOString(), version: version + 1 });

    // Fire-and-forget: delete ImageKit files no longer referenced anywhere in
    // the saved state (unsaved fresh uploads get a grace window).
    imagekit.collectGarbage({ subjects, important });
  })
);

router.post(
  '/uploads',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!imagekit.isConfigured()) return res.status(503).json(imagekit.NOT_CONFIGURED);
    if (!req.file) return res.status(400).json({ error: 'No file provided (field name: file)' });
    const stored = await imagekit.storeImage(req.file);
    await imagekit.registerUpload(stored);
    res.status(201).json({ url: stored.url });
  })
);

module.exports = router;
