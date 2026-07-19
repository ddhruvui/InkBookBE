// One-time migration: v1 notebook document -> v2 subject document (SPEC.md shape).
// Inserts the converted subject and verifies it. The old v1 doc is only removed
// when run with --purge (it is invisible to the v2 API either way).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const mongoose = require('mongoose');

const V1_ID = '6a5b76919fa45333186663e2';

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.db.collection('InkBook');

  const old = await col.findOne({ _id: new mongoose.Types.ObjectId(V1_ID) });
  if (!old) {
    console.log('v1 doc already migrated/absent — nothing to do');
    process.exit(0);
  }

  const subject = {
    _id: crypto.randomUUID(),
    kind: 'subject',
    name: old.name,
    color: '#b8552e',
    position: 0,
    chapters: [
      {
        id: crypto.randomUUID(),
        name: 'Notes',
        position: 0,
        topics: (old.notes || []).map((note, i) => ({
          id: crypto.randomUUID(),
          name: note.title || 'Untitled',
          position: i,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          blocks: [
            { id: crypto.randomUUID(), type: 'text', payload: { html: note.content || '' } },
          ],
        })),
      },
    ],
    createdAt: old.createdAt,
    updatedAt: old.updatedAt,
  };

  await col.insertOne(subject);
  const check = await col.findOne({ _id: subject._id });
  if (!check || !check.chapters?.[0]?.topics?.length) {
    console.error('verification failed — old doc left untouched');
    process.exit(1);
  }
  console.log(`migrated "${old.name}" (${check.chapters[0].topics.length} topic(s)) -> subject ${subject._id}`);

  if (process.argv.includes('--purge')) {
    await col.deleteOne({ _id: new mongoose.Types.ObjectId(V1_ID) });
    console.log('removed old v1 document', V1_ID);
  } else {
    console.log('old v1 document left in place (run with --purge to remove it)');
  }
  process.exit(0);
})().catch((e) => {
  console.error('migration failed:', e.message);
  process.exit(1);
});
