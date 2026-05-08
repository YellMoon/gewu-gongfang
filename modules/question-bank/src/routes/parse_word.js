/**
 * 题库模块 - Word文档导入路由
 * 接收Word文件上传，调用Python解析器提取题目
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const PARSER_SCRIPT = path.join(__dirname, '..', 'parsers', 'parse_word.py');
const KNOWLEDGE_TREE = path.join(__dirname, '..', '..', 'data', 'knowledge_tree.json');

// Ensure uploads dir
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });

/**
 * POST /parse-word
 * 上传Word文件并解析题目
 * Body: multipart/form-data with 'file' field + 'source_type' (lecture|exam)
 */
router.post('/', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: '未上传文件' });

  const sourceType = req.body.source_type || 'lecture';
  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.doc', '.docx'].includes(ext)) {
    fs.unlinkSync(file.path);
    return res.status(400).json({ error: '仅支持 .doc / .docx 格式' });
  }

  // Build args: python parse_word.py <file_path> <source_type> [knowledge_tree_path]
  const args = [PARSER_SCRIPT, file.path, sourceType];
  if (fs.existsSync(KNOWLEDGE_TREE)) args.push(KNOWLEDGE_TREE);

  const proc = spawn('python3', args, { timeout: 60000 });
  let stdout = '', stderr = '';

  proc.stdout.on('data', (data) => { stdout += data.toString(); });
  proc.stderr.on('data', (data) => { stderr += data.toString(); });

  proc.on('close', (code) => {
    // Cleanup uploaded file
    try { fs.unlinkSync(file.path); } catch(e) {}

    if (code !== 0) {
      console.error(`Word parse error (${code}):`, stderr);
      return res.status(500).json({ error: '解析失败', detail: stderr.slice(0, 500) });
    }

    try {
      const result = JSON.parse(stdout);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: '解析结果格式错误', output: stdout.slice(0, 500) });
    }
  });

  proc.on('error', (err) => {
    try { fs.unlinkSync(file.path); } catch(e) {}
    res.status(500).json({ error: `Python进程启动失败: ${err.message}` });
  });
});

module.exports = router;
