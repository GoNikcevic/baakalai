const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const { uploadFile, deleteFile, isS3 } = require('../lib/storage');

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

const MAX_FILE_SIZE = 20 * 1024 * 1024;

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
    if (ALLOWED_TYPES[file.mimetype]) cb(null, true);
    else cb(new Error(`File type not supported: ${file.mimetype}`));
  },
});

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
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries();
      const slides = entries
        .filter(e => e.entryName.match(/ppt\/slides\/slide\d+\.xml/))
        .sort((a, b) => {
          const numA = parseInt(a.entryName.match(/slide(\d+)/)[1]);
          const numB = parseInt(b.entryName.match(/slide(\d+)/)[1]);
          return numA - numB;
        });
      const texts = slides.map(slide => {
        const xml = slide.getData().toString('utf8');
        const parts = [];
        const regex = /<a:t>([^<]*)<\/a:t>/g;
        let match;
        while ((match = regex.exec(xml)) !== null) {
          if (match[1].trim()) parts.push(match[1].trim());
        }
        return parts.join(' ');
      }).filter(Boolean);
      return texts.join('\n\n').slice(0, 100000);
    }
    if (mimeType.startsWith('image/')) {
      return '[Image uploaded]';
    }
    return null;
  } catch (err) {
    console.error(`Parse error for ${filePath}:`, err.message);
    return null;
  }
}

// POST /api/documents/upload
router.post('/upload', upload.array('files', 20), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const results = [];

    // Get doc types from form data
    const docTypes = req.body.docTypes ? JSON.parse(req.body.docTypes) : {};

    for (const file of req.files) {
      // Step 1: Parse file FIRST (while temp file still exists)
      let parsedText = null;
      let parseError = null;
      try {
        parsedText = await parseFile(file.path, file.mimetype);
        if (!parsedText) {
          parseError = 'empty result';
          console.warn(`[documents] Empty parse result for ${file.originalname} (${file.mimetype})`);
        } else {
          console.log(`[documents] Parsed ${file.originalname}: ${parsedText.length} chars`);
        }
      } catch (err) {
        parseError = err.message;
        console.error(`[documents] Parse error for ${file.originalname}:`, err.message);
      }

      // Step 2: Upload to S3
      const storageKey = file.filename;
      if (isS3) {
        const buffer = fs.readFileSync(file.path);
        await uploadFile(storageKey, buffer, file.mimetype);
        // Clean up temp file
        try { fs.unlinkSync(file.path); } catch {}
      }

      // Step 3: Save to DB with parsed text
      const doc = await db.documents.create({
        userId: req.user.id,
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        filePath: isS3 ? `s3://${storageKey}` : file.path,
        parsedText,
        docType: docTypes[file.originalname] || 'other',
      });

      results.push({
        id: doc.id,
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        parsed: !!parsedText,
        parseError,
      });
    }

    res.status(201).json({ uploaded: results });
  } catch (err) {
    next(err);
  }
});

// GET /api/documents
router.get('/', async (req, res, next) => {
  try {
    const docs = await db.documents.listByUser(req.user.id);
    res.json({ documents: docs });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/documents/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const doc = await db.documents.get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (doc.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    try {
      if (doc.file_path && doc.file_path.startsWith('s3://')) {
        // Delete from S3
        const key = doc.file_path.replace('s3://', '');
        await deleteFile(key);
      } else if (doc.file_path && fs.existsSync(doc.file_path)) {
        fs.unlinkSync(doc.file_path);
      }
    } catch (err) {
      console.error('File delete error:', err.message);
    }

    await db.documents.delete(doc.id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/documents/context
router.get('/context', async (req, res, next) => {
  try {
    const docs = await db.documents.getParsedTextByUser(req.user.id);
    const context = docs
      .filter(d => d.parsed_text)
      .map(d => `--- ${d.original_name} ---\n${d.parsed_text}`)
      .join('\n\n');
    res.json({ context, documentCount: docs.length });
  } catch (err) {
    next(err);
  }
});

// Error handler for multer
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 20MB)' });
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.startsWith('File type not supported')) {
    return res.status(415).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
