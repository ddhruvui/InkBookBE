// MONGO_URI keeps the Atlas-style `<db_password>` placeholder; the real
// password lives in MONGO_PASSWORD so the two can be rotated independently.
function resolveMongoUri(uri, password, name = 'MONGO_URI') {
  uri = uri || '';
  if (!uri.includes('<db_password>')) return uri;
  if (!password) {
    throw new Error(`${name} contains <db_password> but ${name.replace(/_URI$/, '_PASSWORD')} is not set`);
  }
  return uri.replace('<db_password>', encodeURIComponent(password));
}

function mongoUri() {
  return resolveMongoUri(process.env.MONGO_URI, process.env.MONGO_PASSWORD);
}

const PROD_DB = 'InkBook';
const TEST_DB = 'InkBookTest';

// Only the Vercel deployment may use the prod database. Vercel sets VERCEL=1
// at build and run time; nothing on this machine does.
const isDeployed = () => !!process.env.VERCEL;

// Atlas treats database names case-insensitively, so "inkbook" is prod too.
const isProdDb = (name) => String(name || '').trim().toLowerCase() === PROD_DB.toLowerCase();

// Database inside the cluster. The deployment defaults to prod ("InkBook");
// every local process defaults to the test copy ("InkBookTest").
function dbName() {
  return (process.env.MONGO_DB_NAME || (isDeployed() ? PROD_DB : TEST_DB)).trim();
}

// Hard stop for any local process (server or script) about to open prod.
// There is deliberately no override flag.
function assertNotProdLocally(name = dbName()) {
  if (!isDeployed() && isProdDb(name)) {
    throw new Error(
      `Refusing to use the prod database "${name}" from a local process. ` +
        `Set MONGO_DB_NAME=${TEST_DB} in server/.env (refresh it with scripts/copy-db.js).`
    );
  }
}

module.exports = { mongoUri, resolveMongoUri, dbName, isProdDb, isDeployed, assertNotProdLocally, PROD_DB, TEST_DB };
