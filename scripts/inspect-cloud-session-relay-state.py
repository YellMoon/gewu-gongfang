#!/usr/bin/env python3
"""Read-only, redacted cloud relay state inspection for desktop identity diagnostics."""

import importlib.util
import base64
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("backend_deploy", ROOT / "scripts" / "deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

QUERY = """
SELECT
  id,
  task_type,
  status,
  phase,
  progress,
  error_code,
  created_at,
  updated_at
FROM miniapp_tasks
WHERE task_type IN ('desktop-session-challenge-start','desktop-session-challenge-exchange')
ORDER BY created_at DESC
LIMIT 12;
""".strip().replace("\n", " ")


def inspect(ssh, label, db_path, remote_dir):
    source = f"""
const crypto = require('crypto');
const Database = require('better-sqlite3');
const db = new Database({json.dumps(db_path)}, {{ readonly: true, fileMustExist: true }});
try {{
  const rows = db.prepare({json.dumps(QUERY)}).all().map(row => ({{
    ...row,
    row_ref: crypto.createHash('sha256').update(String(row.id)).digest('hex').slice(0, 10),
    id: undefined,
  }}));
  console.log(JSON.stringify(rows));
}} finally {{
  db.close();
}}
"""
    encoded = base64.b64encode(source.encode("utf-8")).decode("ascii")
    command = (
        f"cd '{remote_dir}' && "
        f"node -e \"eval(Buffer.from('{encoded}','base64').toString('utf8'))\""
    )
    output, _ = deploy.run(ssh, command)
    rows = json.loads(output or "[]")
    print(json.dumps({"relay": label, "rows": rows}, ensure_ascii=False, indent=2))


def main():
    ssh = deploy.connect()
    try:
        inspect(ssh, "backend", deploy.DB_PATH, deploy.REMOTE_DIR)
        inspect(
            ssh,
            "gateway",
            "/root/education-platform/gateway/data/gateway.db",
            "/root/education-platform/gateway",
        )
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
