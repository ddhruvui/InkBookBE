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

module.exports = { mongoUri, resolveMongoUri };
