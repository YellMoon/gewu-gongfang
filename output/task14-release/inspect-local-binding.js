const Database = require('better-sqlite3');
const db = new Database('D:/GewuDataHost/data/scheduling.db', { readonly: true, fileMustExist: true });
console.log(JSON.stringify({
  authority: db.prepare('SELECT * FROM authority_metadata').all(),
  bindings: db.prepare('SELECT * FROM question_bank_store_bindings').all(),
  questions: db.prepare('SELECT COUNT(*) AS n FROM questions').get().n,
  latestArtifacts: db.prepare(`SELECT artifact_id,format,size_bytes,page_count,formula_count,fallback_count,storage_status,file_path
    FROM paper_artifacts ORDER BY created_at DESC LIMIT 2`).all(),
}, null, 2));
db.close();
