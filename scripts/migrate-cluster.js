// Cluster move: copies the InkBook database from one Atlas cluster to another.
// The source is only ever read. On the target, documents are upserted by _id and
// nothing is deleted, so the script is safe to re-run (e.g. a final sync right
// before switching the deployed server over). An EJSON backup of the source is
// written to backups/ before any write happens.
//
//   MIGRATE_FROM_URI / MIGRATE_FROM_PASSWORD   source cluster (read-only)
//   MIGRATE_TO_URI   / MIGRATE_TO_PASSWORD     target cluster
//
// Both URIs may carry the Atlas `<db_password>` placeholder. The database and
// collection names are pinned below regardless of what the URIs say.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const { MongoClient, BSON } = require('mongodb');
const { resolveMongoUri } = require('../src/db');

const DB_NAME = 'InkBook';
const COLLECTION = 'InkBook';

const canonical = (doc) => BSON.EJSON.stringify(doc, { relaxed: false });
const host = (uri) => uri.replace(/^mongodb(\+srv)?:\/\/[^@]*@/, '');

(async () => {
  const fromUri = resolveMongoUri(process.env.MIGRATE_FROM_URI, process.env.MIGRATE_FROM_PASSWORD, 'MIGRATE_FROM_URI');
  const toUri = resolveMongoUri(process.env.MIGRATE_TO_URI, process.env.MIGRATE_TO_PASSWORD, 'MIGRATE_TO_URI');
  if (!fromUri || !toUri) throw new Error('MIGRATE_FROM_URI and MIGRATE_TO_URI are required');
  if (host(fromUri).split('/')[0] === host(toUri).split('/')[0]) {
    throw new Error('source and target are the same cluster — refusing to run');
  }
  console.log(`from: ${host(fromUri)}`);
  console.log(`to:   ${host(toUri)}`);

  const from = new MongoClient(fromUri);
  const to = new MongoClient(toUri);
  await from.connect();
  await to.connect();
  const src = from.db(DB_NAME).collection(COLLECTION);
  const dst = to.db(DB_NAME).collection(COLLECTION);

  // 1. Read everything from the source and back it up before touching the target.
  const docs = await src.find({}).sort({ _id: 1 }).toArray();
  const indexes = await src.indexes();
  const backupDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `inkbook-${new Date().toISOString().replace(/[:.]/g, '-')}.ejson.json`);
  fs.writeFileSync(
    backupFile,
    BSON.EJSON.stringify(
      { exportedAt: new Date(), source: host(fromUri), db: DB_NAME, collection: COLLECTION, indexes, documents: docs },
      { relaxed: false },
      2
    )
  );
  console.log(`backup: ${docs.length} docs -> ${path.relative(process.cwd(), backupFile)}`);

  // 2. Recreate the source's secondary indexes on the target (idempotent).
  for (const idx of indexes) {
    if (idx.name === '_id_') continue;
    const { key, v, ns, ...options } = idx;
    await dst.createIndex(key, options);
  }

  // 3. Upsert every document by _id. Existing target docs with the same _id are
  //    replaced with the source version; nothing is ever removed.
  const before = await dst.countDocuments();
  let inserted = 0, replaced = 0, unchanged = 0;
  for (const doc of docs) {
    const r = await dst.replaceOne({ _id: doc._id }, doc, { upsert: true });
    if (r.upsertedCount) inserted++;
    else if (r.modifiedCount) replaced++;
    else unchanged++;
  }
  console.log(`target had ${before} docs; inserted ${inserted}, replaced ${replaced}, unchanged ${unchanged}`);

  // 4. Verify every source document exists on the target byte-for-byte.
  let mismatches = 0;
  for (const doc of docs) {
    const copy = await dst.findOne({ _id: doc._id });
    if (!copy || canonical(copy) !== canonical(doc)) {
      mismatches++;
      console.error(`MISMATCH _id=${String(doc._id)} ${copy ? '(content differs)' : '(missing on target)'}`);
    }
  }
  const srcIds = new Set(docs.map((d) => String(d._id)));
  const extras = (await dst.find({}, { projection: { _id: 1 } }).toArray()).filter((d) => !srcIds.has(String(d._id)));
  if (extras.length) {
    console.log(`note: target has ${extras.length} doc(s) not on source (left untouched): ${extras.map((d) => String(d._id)).join(', ')}`);
  }
  const after = await dst.countDocuments();
  console.log(`verify: ${docs.length - mismatches}/${docs.length} source docs identical on target; target now has ${after} docs`);

  await from.close();
  await to.close();
  if (mismatches) {
    console.error('VERIFICATION FAILED — do not switch over');
    process.exit(1);
  }
  console.log('OK — all source documents are present and identical on the target');
})().catch((err) => {
  console.error('migration failed:', err.message);
  process.exit(1);
});
