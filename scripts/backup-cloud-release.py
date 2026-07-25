#!/usr/bin/env python3
"""Create a consistent, append-only cloud backend release backup."""

import base64
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("backend_deploy", ROOT / "scripts" / "deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def main():
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_dir = f"/root/scheduling-backups/backend/{stamp}"
    backup_db = f"{backup_dir}/scheduling.db"
    backup_code = f"{backup_dir}/backend-code.tar.gz"
    database_source = f"""
const Database = require('better-sqlite3');
const source = new Database({json.dumps(deploy.DB_PATH)}, {{
  readonly: true,
  fileMustExist: true,
}});
source.backup({json.dumps(backup_db)})
  .then(() => {{
    const backup = new Database({json.dumps(backup_db)}, {{
      readonly: true,
      fileMustExist: true,
    }});
    const quickCheck = backup.pragma('quick_check', {{ simple: true }});
    backup.close();
    source.close();
    if (quickCheck !== 'ok') throw new Error('BACKUP_QUICK_CHECK_FAILED');
    console.log('DB_BACKUP_OK');
  }})
  .catch(error => {{
    try {{ source.close(); }} catch {{}}
    console.error(error.message);
    process.exit(1);
  }});
"""
    encoded_source = base64.b64encode(database_source.encode("utf-8")).decode("ascii")

    ssh = deploy.connect()
    try:
        deploy.run(ssh, f"mkdir -p '{backup_dir}'")
        deploy.run(
            ssh,
            f"cd '{deploy.REMOTE_DIR}' && "
            f"node -e \"eval(Buffer.from('{encoded_source}','base64').toString('utf8'))\"",
            timeout=120,
        )
        deploy.run(
            ssh,
            f"tar -C '{deploy.REMOTE_DIR}' -czf '{backup_code}' "
            "--exclude=node_modules --exclude=data .",
            timeout=120,
        )
        deploy.run(
            ssh,
            f"test -s '{backup_db}' && test -s '{backup_code}'",
        )
    finally:
        ssh.close()

    print(f"BACKUP_DIR={backup_dir}")


if __name__ == "__main__":
    main()
