// Replace the local test database with a small demo notebook that exercises
// every block type — handy for UI work without personal notes on screen.
//
//   node scripts/seed-test-db.js            # refuses a non-empty target
//   node scripts/seed-test-db.js --replace  # wipe the target first
//
// Safety: same guard as the server — refuses the prod database ("InkBook")
// from any local process. Uses MONGO_DB_NAME (default InkBookTest).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const { randomUUID: uuid } = require('crypto');
const { mongoUri, dbName, assertNotProdLocally, isProdDb } = require('../src/db');

const REPLACE = process.argv.includes('--replace');
const COLLECTION = 'InkBook';

const DAY = 864e5;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const block = (type, payload) => ({ id: uuid(), type, payload });
const text = (html) => block('text', { html });
const topic = (name, days, blocks) => ({ id: uuid(), name, createdAt: ago(days + 3), updatedAt: ago(days), blocks });
const chapter = (name, topics) => ({ id: uuid(), name, topics: topics.map((t, i) => ({ ...t, position: i })) });
const subject = (name, color, chapters) => ({
  _id: uuid(),
  kind: 'subject',
  name,
  color,
  chapters: chapters.map((c, i) => ({ ...c, position: i })),
});

const HL = "<span style='background:#f5d98f;padding:0 3px;border-radius:3px'>";

const forceDiagram = `<svg viewBox="0 0 260 150" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="11">
  <rect x="95" y="55" width="70" height="40" rx="4" fill="#fdf6e3" stroke="#c9962e" stroke-width="2"/>
  <text x="130" y="79" text-anchor="middle" fill="#5a4d3a">m</text>
  <line x1="165" y1="75" x2="235" y2="75" stroke="#b8552e" stroke-width="2.5"/>
  <polygon points="235,69 247,75 235,81" fill="#b8552e"/>
  <text x="206" y="66" text-anchor="middle" fill="#b8552e">F</text>
  <line x1="130" y1="95" x2="130" y2="135" stroke="#5a6aa8" stroke-width="2.5"/>
  <polygon points="124,133 130,145 136,133" fill="#5a6aa8"/>
  <text x="142" y="128" fill="#5a6aa8">mg</text>
  <line x1="20" y1="95" x2="240" y2="95" stroke="#9a875f" stroke-width="1" stroke-dasharray="4 3"/>
</svg>`;

const cellDiagram = `<svg viewBox="0 0 260 140" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="10">
  <ellipse cx="130" cy="70" rx="115" ry="60" fill="#fdfaf2" stroke="#1f8a70" stroke-width="2"/>
  <circle cx="105" cy="68" r="24" fill="#efe6d6" stroke="#8a5aa8" stroke-width="2"/>
  <text x="105" y="72" text-anchor="middle" fill="#8a5aa8">nucleus</text>
  <ellipse cx="185" cy="52" rx="26" ry="12" fill="#fdf6e3" stroke="#b8552e" stroke-width="2"/>
  <text x="185" y="56" text-anchor="middle" fill="#b8552e">mito</text>
  <ellipse cx="180" cy="95" rx="18" ry="9" fill="#e8f0dd" stroke="#4a6428" stroke-width="1.5"/>
  <text x="180" y="98" text-anchor="middle" fill="#4a6428">ER</text>
</svg>`;

// Simple illustrative image as a data URI (never an ImageKit URL, so the
// server's image garbage collector ignores it).
const sampleImage =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220">
  <rect width="400" height="220" fill="#fdfaf2"/>
  <path d="M20 180 Q 110 20 200 110 T 380 60" fill="none" stroke="#2e7aa8" stroke-width="4"/>
  <line x1="20" y1="200" x2="380" y2="200" stroke="#9a875f" stroke-width="2"/>
  <line x1="20" y1="20" x2="20" y2="200" stroke="#9a875f" stroke-width="2"/>
  <text x="200" y="214" font-family="sans-serif" font-size="12" fill="#6b5d48" text-anchor="middle">time</text>
</svg>`);

function build() {
  const newton = topic("Newton's Laws", 0, [
    text(
      `<b>First law (inertia):</b> a body stays at rest or in uniform motion unless a net external force acts on it.\n` +
        `<b>Second law:</b> ${HL}net force equals mass times acceleration</span>.\n` +
        `<b>Third law:</b> every action has an equal and opposite reaction. See also [[Kinematics]].`
    ),
    block('math', { text: '\\vec{F}_{net} = m\\,\\vec{a}' }),
    block('diagram', { svg: forceDiagram, caption: 'Free-body diagram — applied force F and weight mg' }),
    block('todo', { text: 'Solve the inclined-plane problem set (Q1–Q8)', done: true }),
    block('todo', { text: 'Re-derive F = ma from momentum, F = dp/dt', done: false }),
    text('<em>Tip:</em> always draw the free-body diagram before writing any equation.'),
  ]);

  const kinematics = topic('Kinematics', 2, [
    text('Equations of motion for <b>constant acceleration</b>. They only apply when a is constant — check that first.'),
    block('table', {
      rows: [
        ['Equation', 'Missing variable', 'Use when'],
        ['v = u + at', 's', 'no displacement given'],
        ['s = ut + ½at²', 'v', 'final velocity unknown'],
        ['v² = u² + 2as', 't', 'time not given'],
        ['s = ½(u + v)t', 'a', 'acceleration unknown'],
      ],
    }),
    block('image', { url: sampleImage, caption: 'Position–time graph: the slope is the velocity' }),
  ]);

  const waves = topic('Wave Basics', 9, [
    text('A wave carries energy without carrying matter. Speed, frequency and wavelength are linked by v = fλ.'),
    block('math', { text: 'v = f\\lambda' }),
    block('scan', {
      imageUrl: null,
      transcript:
        'Transverse — particles move ⟂ to the direction of travel (light, string).\nLongitudinal — particles move ∥ (sound). Compressions + rarefactions.',
    }),
  ]);

  const binarySearch = topic('Binary Search', 1, [
    text(`Works on a <b>sorted</b> array. Halve the search range each step → ${HL}O(log n)</span> time.`),
    block('code', {
      lang: 'python',
      text: 'def binary_search(a, target):\n    lo, hi = 0, len(a) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if a[mid] == target:\n            return mid\n        if a[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return -1',
    }),
    block('code2', {
      lang: 'python',
      before: 'mid = (lo + hi) / 2   # float index!',
      after: 'mid = (lo + hi) // 2  # integer division',
    }),
    block('link', { text: 'Visualising binary search', url: 'https://en.wikipedia.org/wiki/Binary_search_algorithm' }),
  ]);

  const bigO = topic('Big-O Cheatsheet', 5, [
    block('table', {
      rows: [
        ['Structure', 'Access', 'Search', 'Insert'],
        ['Array', 'O(1)', 'O(n)', 'O(n)'],
        ['Hash table', '—', 'O(1) avg', 'O(1) avg'],
        ['Balanced BST', 'O(log n)', 'O(log n)', 'O(log n)'],
        ['Linked list', 'O(n)', 'O(n)', 'O(1)'],
      ],
    }),
    text('Average vs worst case matters: a hash table degrades to O(n) when everything collides. [[Binary Search]] needs sorted input.'),
  ]);

  const hashMaps = topic('Hash Maps', 12, [
    text('A hash function maps keys to bucket indexes. Collisions are handled by <b>chaining</b> or <b>open addressing</b>.'),
    block('code', {
      lang: 'javascript',
      text: "const counts = new Map();\nfor (const word of words) {\n  counts.set(word, (counts.get(word) ?? 0) + 1);\n}",
    }),
  ]);

  const cell = topic('Cell Structure', 3, [
    text(`The ${HL}mitochondria</span> produce ATP through cellular respiration. The nucleus stores DNA; the ER folds and transports proteins.`),
    block('diagram', { svg: cellDiagram, caption: 'Animal cell — main organelles' }),
    block('todo', { text: 'Label the plant-cell diagram (cell wall, chloroplast, vacuole)', done: false }),
  ]);

  const photosynthesis = topic('Photosynthesis', 20, [
    block('math', { text: '6CO_2 + 6H_2O \\xrightarrow{light} C_6H_{12}O_6 + 6O_2' }),
    text('Light-dependent reactions happen in the <b>thylakoid</b>; the Calvin cycle happens in the <b>stroma</b>.'),
  ]);

  const subjects = [
    subject('Physics', '#b8552e', [chapter('Mechanics', [newton, kinematics]), chapter('Waves', [waves])]),
    subject('Computer Science', '#5a6aa8', [
      chapter('Algorithms', [binarySearch, bigO]),
      chapter('Data Structures', [hashMaps]),
      chapter('Operating Systems', []),
    ]),
    subject('Biology', '#1f8a70', [chapter('Cells', [cell]), chapter('Plants', [photosynthesis])]),
  ].map((s, i) => ({ ...s, position: i }));

  const marks = [
    { id: uuid(), topicId: newton.id, text: 'net force equals mass times acceleration', createdAt: ago(0) },
    { id: uuid(), topicId: kinematics.id, text: 'They only apply when a is constant', createdAt: ago(2) },
    { id: uuid(), topicId: binarySearch.id, text: 'Halve the search range each step', createdAt: ago(1) },
  ];

  return [
    ...subjects,
    { _id: 'important-marks', kind: 'important-marks', marks },
    { _id: 'state-meta', kind: 'state-meta', version: 1 },
  ];
}

(async () => {
  const name = dbName();
  assertNotProdLocally(name);
  if (isProdDb(name)) throw new Error(`Refusing to seed the prod database "${name}".`);

  const conn = await mongoose.createConnection(mongoUri()).asPromise();
  try {
    const col = conn.useDb(name, { useCache: false }).collection(COLLECTION);
    const existing = await col.countDocuments();
    if (existing && !REPLACE) {
      throw new Error(`"${name}.${COLLECTION}" already has ${existing} docs — pass --replace to wipe it first.`);
    }
    if (existing) await col.deleteMany({});
    const docs = build();
    await col.insertMany(docs);
    console.log(`Seeded "${name}" with ${docs.length} docs (removed ${existing}).`);
  } finally {
    await conn.close();
  }
})().catch((err) => {
  console.error('seed-test-db failed:', err.message);
  process.exit(1);
});
