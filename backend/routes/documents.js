const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = {
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(12).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase() || ALLOWED_TYPES[file.mimetype] || '';
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error(`File type not supported: ${file.mimetype}`));
    }
  },
});

// Parse text from uploaded file
async function parseFile(filePath, mimeType) {
  try {
    if (mimeType === 'text/plain' || mimeType === 'text/csv') {
      return fs.readFileSync(filePath, 'utf-8').slice(0, 100000);
    }

    if (mimeType === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      return (data.text || '').slice(0, 100000);
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return (result.value || '').slice(0, 100000);
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(filePath);
      const sheets = workbook.SheetNames.map(name => {
        const sheet = workbook.Sheets[name];
        return `[${name}]\n${XLSX.utils.sheet_to_csv(sheet)}`;
      });
      return sheets.join('\n\n').slice(0, 100000);
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      // Basic PPTX: extract from XML inside zip
      const XLSX = require('xlsx');
      // PPTX is a zip; we'll just note it as uploaded
      return '[PPTX file uploaded — content will be processed]';
    }

    // Images — no text extraction, just note the upload
    if (mimeType.startsWith('image/')) {
      return '[Image uploaded]';
    }

    return null;
  } catch (err) {
    console.error(`Parse error for ${filePath}:`, err.message);
    return null;
  }
}

// POST /api/documents/upload — Upload one or multiple files
router.post('/upload', upload.array('files', 20), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const results = [];

  for (const file of req.files) {
    const parsedText = await parseFile(file.path, file.mimetype);

    const doc = db.documents.create({
      userId: req.user.id,
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      filePath: file.path,
      parsedText,
    });

    results.push({
      id: doc.id,
      originalName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      parsed: !!parsedText,
    });
  }

  res.status(201).json({ uploaded: results });
});

// GET /api/documents — List user's documents
router.get('/', (req, res) => {
  const docs = db.documents.listByUser(req.user.id);
  res.json({ documents: docs });
});

// DELETE /api/documents/:id — Delete a document
router.delete('/:id', (req, res) => {
  const doc = db.documents.get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

  // Delete file from disk
  try {
    if (fs.existsSync(doc.file_path)) {
      fs.unlinkSync(doc.file_path);
    }
  } catch (err) {
    console.error('File delete error:', err.message);
  }

  db.documents.delete(doc.id);
  res.json({ deleted: true });
});

// GET /api/documents/context — Get all parsed text for AI context
router.get('/context', (req, res) => {
  const docs = db.documents.getParsedTextByUser(req.user.id);
  const context = docs
    .filter(d => d.parsed_text)
    .map(d => `--- ${d.original_name} ---\n${d.parsed_text}`)
    .join('\n\n');
  res.json({ context, documentCount: docs.length });
});

// Error handler for multer
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large (max 20MB)' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.startsWith('File type not supported')) {
    return res.status(415).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
