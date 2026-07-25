import importlib.util
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("gewu_deploy", ROOT / "scripts" / "deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

version = "6.0.0"
stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
backup_dir = f"/root/scheduling-backups/release-{version}/{stamp}"
remote_helper = f"/tmp/gewu-release-backup-{stamp}.js"
helper_source = r"""
const fs = require('fs');
const [modulePath, sourcePath, destinationPath] = process.argv.slice(2);
if (!fs.existsSync(sourcePath)) throw new Error(`missing database: ${sourcePath}`);
const Database = require(modulePath);
const source = new Database(sourcePath);
source.pragma('wal_checkpoint(FULL)');
source.backup(destinationPath).then(() => {
  source.close();
  const copy = new Database(destinationPath, { readonly: true });
  const quickCheck = copy.pragma('quick_check', { simple: true });
  copy.close();
  if (quickCheck !== 'ok') throw new Error(`quick_check failed: ${quickCheck}`);
  console.log(JSON.stringify({ destinationPath, quickCheck, size: fs.statSync(destinationPath).size }));
}).catch(error => {
  try { source.close(); } catch (_) {}
  console.error(error.message);
  process.exit(1);
});
""".strip() + "\n"


ssh = deploy.connect()
try:
    deploy.run(ssh, f"mkdir -p '{backup_dir}'")
    deploy.run(
        ssh,
        f"tar -C '/root/scheduling-backend' -czf '{backup_dir}/backend-code.tar.gz' "
        "--exclude=node_modules --exclude=data .",
        timeout=180,
    )
    deploy.run(
        ssh,
        f"tar -C '/root/education-platform/gateway' -czf '{backup_dir}/gateway-code.tar.gz' "
        "--exclude=node_modules --exclude=data .",
        timeout=180,
    )
    sftp = ssh.open_sftp()
    try:
        with sftp.file(remote_helper, "w") as stream:
            stream.write(helper_source)
    finally:
        sftp.close()
    deploy.run(
        ssh,
        f"node '{remote_helper}' '/root/scheduling-backend/node_modules/better-sqlite3' "
        f"'/root/scheduling-data/prod/scheduling.db' '{backup_dir}/backend.db'",
        timeout=180,
    )
    deploy.run(
        ssh,
        f"node '{remote_helper}' '/root/education-platform/gateway/node_modules/better-sqlite3' "
        f"'/root/education-platform/gateway/data/gateway.db' '{backup_dir}/gateway.db'",
        timeout=180,
    )
    deploy.run(
        ssh,
        f"cd '{backup_dir}' && sha256sum backend-code.tar.gz gateway-code.tar.gz backend.db gateway.db "
        "&& stat -c '%n %s bytes' backend-code.tar.gz gateway-code.tar.gz backend.db gateway.db",
    )
    print(f"BACKUP_DIR={backup_dir}")
finally:
    try:
        sftp = ssh.open_sftp()
        try:
            sftp.remove(remote_helper)
        except FileNotFoundError:
            pass
        finally:
            sftp.close()
    finally:
        ssh.close()
