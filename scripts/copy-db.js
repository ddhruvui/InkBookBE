// Copy the notebook from one database to another in the same cluster, e.g. to
// refresh the local test database from prod:
//
//   node scripts/copy-db.js                    # InkBook → InkBookTest
//   node scripts/copy-db.js --replace          # wipe InkBookTest first
//   node scripts/copy-db.js --from X --to Y
//
// Safety:
//  · The source is only read (find), never written.
//  · Refuses to write into "InkBook" (prod) and refuses source === target.
//  · Refuses a non-empty target unless --replace is passed.
//  · Skips the ImageKit "image-index" doc: it lists prod image file ids, and a
//    local save would garbage-collect (delete) entries from it on ImageKit.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const { mongoUri, isProdDb } = require('../src/db');

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const FROM = arg('--from', 'InkBook');
const TO = arg('--to', 'InkBookTest');
const REPLACE = process.argv.includes('--replace');
const COLLECTION = 'InkBook';
const SKIP_KINDS = ['image-index'];

(async () => {
  if (isProdDb(TO)) throw new Error(`Refusing to write into the prod database "${TO}".`);
  if (FROM.toLowerCase() === TO.toLowerCase()) throw new Error('Source and target are the same database.');

  const conn = await mongoose.createConnection(mongoUri()).asPromise();
  try {
    const src = conn.useDb(FROM, { useCache: false }).collection(COLLECTION);
    const dst = conn.useDb(TO, { useCache: false }).collection(COLLECTION);

    const existing = await dst.countDocuments();
    if (existing && !REPLACE) {
      throw new Error(`"${TO}.${COLLECTION}" already has ${existing} docs — pass --replace to overwrite it.`);
    }

    const docs = await src.find({ kind: { $nin: SKIP_KINDS } }).toArray();
    if (existing) await dst.deleteMany({});
    if (docs.length) await dst.insertMany(docs, { ordered: true });

    const byKind = docs.reduce((m, d) => ((m[d.kind] = (m[d.kind] || 0) + 1), m), {});
    const copied = await dst.countDocuments();
    console.log(`Copied ${docs.length} docs ${FROM} → ${TO} (${JSON.stringify(byKind)}); target now has ${copied}.`);
    if (copied !== docs.length) throw new Error('Target count does not match the copy.');
  } finally {
    await conn.close();
  }
})().catch((err) => {
  console.error('copy-db failed:', err.message);
  process.exit(1);
});
