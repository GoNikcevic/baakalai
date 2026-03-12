const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'projects');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = {
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/svg+xml': '.svg',
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;

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
    if (mimeType === 'text/plain' || mimeType === 'text/csv' || mimeType === 'text/markdown') {
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
    if (mimeType.startsWith('image/')) return '[Image uploaded]';
    return null;
  } catch (err) {
    console.error(`Parse error for ${filePath}:`, err.message);
    return null;
  }
}

async function getProjectOrFail(req, res) {
  const project = await db.projects.get(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  if (project.user_id !== req.user.id) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  return project;
}

// GET /api/projects
router.get('/', async (req, res, next) => {
  try {
    const projects = await db.projects.list(req.user.id);

    const result = [];
    for (const p of projects) {
      const files = await db.projectFiles.listByProject(p.id);
      const countResult = await db.query(
        'SELECT COUNT(*) as c FROM campaigns WHERE project_id = $1 AND user_id = $2',
        [p.id, req.user.id]
      );
      const campaignCount = parseInt(countResult.rows[0].c, 10);

      result.push({
        id: p.id,
        name: p.name,
        client: p.client,
        description: p.description,
        color: p.color,
        createdDate: p.created_at,
        campaignCount,
        files: files.map(f => ({
          id: f.id,
          name: f.original_name,
          type: f.mime_type,
          size: f.file_size,
          uploadedAt: f.created_at,
          category: f.category,
        })),
      });
    }

    res.json({ projects: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects
router.post('/', async (req, res, next) => {
  try {
    const { name, client, description, color } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const project = await db.projects.create({
      userId: req.user.id,
      name: name.trim(),
      client: client || null,
      description: description || null,
      color: color || 'var(--blue)',
    });

    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/projects/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const project = await getProjectOrFail(req, res);
    if (!project) return;

    const updated = await db.projects.update(project.id, req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/projects/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const project = await getProjectOrFail(req, res);
    if (!project) return;

    const files = await db.projectFiles.listByProject(project.id);
    for (const f of files) {
      try {
        if (fs.existsSync(f.file_path)) fs.unlinkSync(f.file_path);
      } catch (err) {
        console.error('File cleanup error:', err.message);
      }
    }

    // Unlink campaigns from this project
    await db.query('UPDATE campaigns SET project_id = NULL WHERE project_id = $1', [project.id]);

    await db.projects.delete(project.id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:id/files
router.post('/:id/files', upload.single('file'), async (req, res, next) => {
  try {
    const project = await getProjectOrFail(req, res);
    if (!project) return;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const parsedText = await parseFile(req.file.path, req.file.mimetype);

    const fileRecord = await db.projectFiles.create({
      projectId: project.id,
      userId: req.user.id,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      filePath: req.file.path,
      parsedText,
      category: req.body.category || 'other',
    });

    res.status(201).json({
      id: fileRecord.id,
      name: req.file.originalname,
      type: req.file.mimetype,
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
      category: req.body.category || 'other',
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/projects/:id/files/:fileId
router.delete('/:id/files/:fileId', async (req, res, next) => {
  try {
    const project = await getProjectOrFail(req, res);
    if (!project) return;

    const file = await db.projectFiles.get(req.params.fileId);
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (file.project_id !== project.id) return res.status(403).json({ error: 'File does not belong to this project' });

    try {
      if (fs.existsSync(file.file_path)) fs.unlinkSync(file.file_path);
    } catch (err) {
      console.error('File delete error:', err.message);
    }

    await db.projectFiles.delete(file.id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/:id/context
router.get('/:id/context', async (req, res, next) => {
  try {
    const project = await getProjectOrFail(req, res);
    if (!project) return;

    const docs = await db.projectFiles.getContextByProject(project.id);
    const context = docs
      .filter(d => d.parsed_text)
      .map(d => `--- ${d.original_name} [${d.category}] ---\n${d.parsed_text}`)
      .join('\n\n');

    res.json({ context, fileCount: docs.length, projectId: project.id });
  } catch (err) {
    next(err);
  }
});

// Multer error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 10 Mo)' });
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.startsWith('File type not supported')) {
    return res.status(415).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
