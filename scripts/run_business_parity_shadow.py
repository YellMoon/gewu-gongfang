"""Run source desktop against a disposable full cloud backup, never production."""
import argparse
import hashlib
import io
import json
import pathlib
import re
import secrets
import select
import socketserver
import subprocess
import tarfile
import tempfile
import threading
import urllib.request

import deploy
from apply_cloud_postgres_migrations import DockerPsqlExecutor, apply_migrations, read_migrations

ROOT = pathlib.Path(__file__).resolve().parents[1]


def validate_backup(value):
    root = value.get('root', '')
    if (not re.fullmatch(r'/root/scheduling-backups/postgres/[0-9]{8}-[0-9]{6}', root)
            or value.get('dump') != root + '/gewu_cloud.dump'
            or not re.fullmatch(r'[a-f0-9]{64}', value.get('sha256', ''))
            or value.get('restoreVerified') is not True
            or value.get('ownershipAndPrivilegesVerified') is not True
            or not re.fullmatch(r'[a-f0-9]{32}', value.get('securityFingerprint', ''))):
        raise RuntimeError('VERIFIED_BACKUP_REQUIRED')
    return value


def validate_target(target):
    if not re.fullmatch(r'gewu_ui_shadow_[a-f0-9]{16}', target):
        raise RuntimeError('ISOLATED_SHADOW_REQUIRED')
    return target


def export_committed_source(repo, commit, destination):
    """Export only committed cloud inputs; never alter or register a worktree."""
    if not re.fullmatch(r'[a-f0-9]{40}', commit or ''):
        raise RuntimeError('EXACT_SOURCE_COMMIT_REQUIRED')
    destination = pathlib.Path(destination)
    if destination.exists():
        raise FileExistsError(destination)
    paths = ['cloud-business-api/src', 'cloud-business-api/scripts', 'cloud-business-api/sql',
             'cloud-business-api/server.js', 'cloud-business-api/package.json', 'shared']
    payload = subprocess.run(['git', 'archive', '--format=tar', commit, '--', *paths],
                             cwd=repo, check=True, capture_output=True, timeout=60).stdout
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:') as archive:
        for item in archive.getmembers():
            name = pathlib.PurePosixPath(item.name)
            if (name.is_absolute() or '..' in name.parts or '\\' in item.name or ':' in item.name
                    or not name.parts or name.parts[0] not in ('cloud-business-api', 'shared')
                    or not (item.isfile() or item.isdir())):
                raise RuntimeError('UNSAFE_SOURCE_ARCHIVE')
        destination.mkdir(parents=True, exist_ok=False)
        archive.extractall(destination, filter='data')
    return destination


def run(backup_path, probe_only=False, course_confirmation_only=False, resource_confirmation_only=False, course_address_only=False, cloud_source_commit=None, confirmed_delete_undo_only=False):
    backup = validate_backup(json.loads(pathlib.Path(backup_path).read_text(encoding='utf-8')))
    nonce = secrets.token_hex(8)
    target = validate_target('gewu_ui_shadow_' + nonce)
    container = 'gewu-ui-shadow-' + nonce
    remote = '/tmp/' + container
    out = pathlib.Path(tempfile.mkdtemp(prefix='gewu-business-parity-'))
    cloud_root = export_committed_source(ROOT, cloud_source_commit, out / 'committed-source') if cloud_source_commit else ROOT
    ssh = deploy.connect()
    created = staged = app_created = False
    tunnel = None
    # UTF-8: focused reruns keep explicit scope and never claim the full UI matrix.
    receipt = {'database': target, 'productionWrite': False, 'uiVerified': False,
               'cloudSourceCommit': cloud_source_commit,
               'scope': 'confirmed-delete-undo-only' if confirmed_delete_undo_only else 'course-address-only' if course_address_only else 'resource-confirmation-only' if resource_confirmation_only else 'course-confirmation-only' if course_confirmation_only else 'business-parity'}

    def private(command):
        stdin, stdout, stderr = ssh.exec_command(command, timeout=180)
        stdin.channel.shutdown_write()
        body = stdout.read().decode('utf-8')
        stderr.read()
        if stdout.channel.recv_exit_status():
            raise RuntimeError('SHADOW_COMMAND_FAILED')
        return body

    try:
        if private("sha256sum '" + backup['dump'] + "'").split()[0] != backup['sha256']:
            raise RuntimeError('BACKUP_CHECKSUM_CHANGED')
        maintenance = DockerPsqlExecutor(ssh, 'gewu-postgres17', 'postgres', 'gewu_app')
        if maintenance.run("SELECT count(*) FROM pg_database WHERE datname='" + target + "'").strip() != '0':
            raise RuntimeError('SHADOW_ALREADY_EXISTS')
        private("docker exec gewu-postgres17 createdb -U gewu_app -T template0 '" + target + "'")
        created = True
        private("docker exec -i gewu-postgres17 pg_restore -U gewu_app --exit-on-error --single-transaction -d '" + target + "' < '" + backup['dump'] + "'")
        db = DockerPsqlExecutor(ssh, 'gewu-postgres17', target, 'gewu_app')
        assert db.run('SELECT current_database()').strip() == target
        actual_security = db.run((ROOT / 'scripts/cloud_postgres_security_fingerprint.sql').read_text(encoding='utf-8')).strip()
        if actual_security != backup['securityFingerprint']:
            raise RuntimeError('SHADOW_SECURITY_FINGERPRINT_MISMATCH')
        receipt['ownershipAndPrivilegesVerified'] = True
        receipt['migrations'] = apply_migrations(db, read_migrations(cloud_root / 'cloud-business-api/sql'))['applied']
        receipt['backupSha256'] = backup['sha256']
        print(json.dumps({'stage': 'shadow_migrated', 'database': target}), flush=True)
        app = json.loads(private('docker inspect gewu-cloud-business-api'))[0]
        pg = json.loads(private('docker inspect gewu-postgres17'))[0]
        network = sorted(set(app['NetworkSettings']['Networks']) & set(pg['NetworkSettings']['Networks']))[0]
        image = app['Image']
        assert re.fullmatch(r'[A-Za-z0-9_.-]+', network) and re.fullmatch(r'sha256:[a-f0-9]{64}', image)
        env = dict(item.split('=', 1) for item in app['Config']['Env'] if '=' in item)
        print(json.dumps({'stage':'shadow_runtime_config','user':env.get('POSTGRES_USER'), 'port':env.get('POSTGRES_PORT')}), flush=True)
        env.update(POSTGRES_DB=target, POSTGRES_HOST='gewu-postgres17', PORT='3002', NODE_PATH='/app/node_modules',
                   CLOUD_PAPER_EXPORT_WORKER_ENABLED='0', WECHAT_APPSECRET=secrets.token_hex(32))
        # Keep only credentials needed for the cloned database. Disable storage/export
        # and use independent ticket signatures so shadow sessions cannot reach production.
        for key in list(env):
            if key.startswith(('CLOUD_STORAGE_', 'OSS_', 'ALIBABA_', 'ALICLOUD_')):
                del env[key]
        env['CLOUD_IDENTITY_TICKET_SECRET'] = secrets.token_hex(32)
        env['CLOUD_MINIAPP_TICKET_SECRET'] = secrets.token_hex(32)
        app = pg = None
        private("umask 077; mkdir '" + remote + "'")
        staged = True
        archive = out / 'source.tar'
        with tarfile.open(archive, 'w') as bundle:
            for folder in ('src', 'scripts'):
                for file in (cloud_root / 'cloud-business-api' / folder).rglob('*.js'):
                    if not file.name.endswith('.test.js'):
                        bundle.add(file, arcname=file.relative_to(cloud_root / 'cloud-business-api').as_posix())
            for name in ('server.js', 'package.json'):
                bundle.add(cloud_root / 'cloud-business-api' / name, arcname=name)
            bundle.add(ROOT / 'scripts/business-parity-shadow-bootstrap.cjs', arcname='bootstrap.cjs')
            for file in (cloud_root / 'shared').rglob('*'):
                if file.is_file() and file.suffix in ('.js','.mjs','.json','.sql') and '.test.' not in file.name:
                    bundle.add(file, arcname='current-shared/' + file.relative_to(cloud_root / 'shared').as_posix())
        receipt['sourceSha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
        sftp = ssh.open_sftp()
        try:
            sftp.put(str(archive), remote + '/source.tar')
        finally:
            sftp.close()
        private("tar -xf '" + remote + "/source.tar' -C '" + remote + "'")
        private("docker create --name '" + container + "' --network '" + network + "' --read-only --user 0 --cap-drop ALL --security-opt no-new-privileges --memory 384m --pids-limit 96 --interactive --publish 127.0.0.1::3002 --env NODE_PATH=/app/node_modules --mount 'type=bind,source=" + remote + ",target=/shadow,readonly' --mount 'type=bind,source=" + remote + "/current-shared,target=/shared,readonly' --entrypoint node '" + image + "' /shadow/bootstrap.cjs")
        app_created = True
        stdin, stdout, stderr = ssh.exec_command("docker start -ai '" + container + "'", timeout=180)
        stdin.write(json.dumps({'env':env})); stdin.flush(); stdin.channel.shutdown_write(); env = None
        login = None
        for _ in range(10):
            line = stdout.readline()
            if not line:
                error = stderr.read().decode('utf-8')
                # Our bootstrap errors are fixed code-only JSON, never credentials.
                try:
                    failure = json.loads(error.strip().splitlines()[-1])
                    code = failure.get('stage', 'UNKNOWN') + ':' + failure.get('code', 'UNKNOWN')
                except (ValueError, IndexError): code = 'UNKNOWN'
                raise RuntimeError('SHADOW_START_FAILED:' + str(code))
            if line.startswith('{'):
                login = json.loads(line).get('shadowLogin')
                if login: break
        if not login:
            raise RuntimeError('SHADOW_LOGIN_NOT_READY')
        ports = private("docker port '" + container + "' 3002/tcp").strip()
        assert re.fullmatch(r'127\.0\.0\.1:[0-9]+', ports)
        remote_port = int(ports.rsplit(':', 1)[1])
        transport = ssh.get_transport()

        class Forward(socketserver.BaseRequestHandler):
            def handle(self):
                channel = transport.open_channel('direct-tcpip', ('127.0.0.1', remote_port), self.request.getpeername())
                try:
                    while True:
                        ready, _, _ = select.select([self.request, channel], [], [], 30)
                        for source in ready:
                            data = source.recv(65536)
                            if not data: return
                            (channel if source is self.request else self.request).sendall(data)
                finally: channel.close()

        class Tunnel(socketserver.ThreadingTCPServer):
            daemon_threads = True
        tunnel = Tunnel(('127.0.0.1', 0), Forward)
        threading.Thread(target=tunnel.serve_forever, daemon=True).start()
        base = 'http://127.0.0.1:' + str(tunnel.server_address[1])
        with urllib.request.urlopen(base + '/api/health', timeout=20) as response:
            receipt['health'] = json.load(response)
        print(json.dumps({'stage':'shadow_api_ready','database':target,'out':str(out)}), flush=True)
        if not probe_only:
            result = subprocess.run(['node', str(ROOT / 'scripts/business-parity-desktop.cjs')],
                input=json.dumps({'baseUrl':base,'login':login,'out':str(out),'courseConfirmationOnly':course_confirmation_only,'resourceConfirmationOnly':resource_confirmation_only,'courseAddressOnly':course_address_only,'confirmedDeleteUndoOnly':confirmed_delete_undo_only}), text=True, encoding='utf-8', cwd=ROOT, timeout=900)
            if result.returncode: raise RuntimeError('DESKTOP_PARITY_FAILED')
            receipt['desktopLoginVerified'] = True
            receipt['uiVerified'] = False  # Full QA inventory still requires its own signoff.
        login = None
        receipt['ok'] = True
        return receipt
    finally:
        if tunnel: tunnel.shutdown(); tunnel.server_close()
        if not ssh.get_transport() or not ssh.get_transport().is_active():
            ssh.close()
            ssh = deploy.connect()
        if app_created: private("docker rm -f '" + container + "'")
        if created:
            validate_target(target)
            private("docker exec gewu-postgres17 dropdb -U gewu_app --if-exists '" + target + "'")
        if staged:
            assert re.fullmatch(r'/tmp/gewu-ui-shadow-[a-f0-9]{16}', remote)
            private("rm -rf -- '" + remote + "'")
        ssh.close()
        receipt['cleanupComplete'] = True
        (out / 'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
        print(json.dumps({'out':str(out),'cleanupComplete':True,'ok':receipt.get('ok',False)}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('backup_path')
    parser.add_argument('--probe-only', action='store_true')
    parser.add_argument('--course-confirmation-only', action='store_true')
    parser.add_argument('--resource-confirmation-only', action='store_true')
    # UTF-8: keep address linkage as an explicit limited evidence scope.
    parser.add_argument('--course-address-only', action='store_true')
    parser.add_argument('--confirmed-delete-undo-only', action='store_true')
    parser.add_argument('--cloud-source-commit', help='Exact commit SHA for cloud code, shared contracts and SQL; excludes dirty changes')
    args = parser.parse_args()
    run(args.backup_path, args.probe_only, args.course_confirmation_only, args.resource_confirmation_only, args.course_address_only, args.cloud_source_commit, args.confirmed_delete_undo_only)
