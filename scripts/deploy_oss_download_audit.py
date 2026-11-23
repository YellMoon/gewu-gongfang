import argparse
import contextlib
import io
import hashlib
import json
import os
import shlex
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REMOTE = '/opt/gewu-download-audit'
CONFIG = '/etc/gewu-download-audit.json'
SERVICE = '''[Unit]
Description=Gewu OSS download audit collector
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
DynamicUser=yes
StateDirectory=gewu-download-audit
StateDirectoryMode=0700
LoadCredential=config:/etc/gewu-download-audit.json
ExecStart=/usr/bin/python3 /opt/gewu-download-audit/collector.py collect --config %d/config
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
TimeoutStartSec=180
'''
TIMER = '''[Unit]
Description=Collect OSS download logs hourly

[Timer]
OnCalendar=hourly
RandomizedDelaySec=120
Persistent=true

[Install]
WantedBy=timers.target
'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--stage-only', action='store_true')
    parser.add_argument('--log-bucket', default='gewu-download-audit-1079575960473975')
    args = parser.parse_args()
    os.environ['APP_ENV'] = 'prod'
    sys.path.insert(0, str(ROOT / 'scripts'))
    import deploy
    with contextlib.redirect_stdout(io.StringIO()):
        ssh = deploy.connect()
    evidence = ROOT / 'output' / 'oss-download-audit'
    evidence.mkdir(parents=True, exist_ok=True)
    try:
        deploy.run(ssh, "python3 -c 'import sqlite3,ssl;print(sqlite3.sqlite_version)'", timeout=20)
        if not args.apply:
            print(json.dumps({'ssh': 'ok', 'mode': 'check', 'logBucket': args.log_bucket}))
            return
        import re
        if not re.fullmatch(r'gewu-download-audit-[0-9]+', args.log_bucket):
            raise ValueError('Unexpected audit bucket')
        key = os.environ.get('OSS_ACCESS_KEY_ID') or os.environ.get('ALIYUN_ACCESS_KEY_ID')
        secret = os.environ.get('OSS_ACCESS_KEY_SECRET') or os.environ.get('ALIYUN_ACCESS_KEY_SECRET')
        if not key or not secret:
            raise ValueError('OSS audit read credential unavailable')
        backup = '/root/scheduling-backups/download-audit/' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
        deploy.run(ssh, 'install -d -m 700 ' + shlex.quote(backup) + '; '
                   + 'for file in /etc/gewu-download-audit.json /etc/systemd/system/gewu-download-audit.service /etc/systemd/system/gewu-download-audit.timer /opt/gewu-download-audit/collector.py; do '
                   + 'if [ -f "$file" ]; then cp --parents --preserve=all "$file" ' + shlex.quote(backup) + '; fi; done; '
                   + 'install -d -m 755 ' + REMOTE, timeout=30)
        config = {'log_bucket': args.log_bucket, 'source_bucket': 'gewu-staging-edu', 'log_prefix': 'access/',
                  'endpoint': 'oss-cn-beijing-internal.aliyuncs.com',
                  'database': '/var/lib/gewu-download-audit/audit.sqlite3',
                  'access_key_id': key, 'access_key_secret': secret}
        with ssh.open_sftp() as sftp:
            uploads = {REMOTE + '/collector.py': (ROOT / 'scripts' / 'oss_download_audit.py').read_bytes(),
                       CONFIG: json.dumps(config).encode('utf-8'),
                       '/etc/systemd/system/gewu-download-audit.service': SERVICE.encode(),
                       '/etc/systemd/system/gewu-download-audit.timer': TIMER.encode()}
            for filename, content in uploads.items():
                with sftp.open(filename, 'wb') as stream:
                    sftp.chmod(filename, 0o600 if filename == CONFIG else 0o644)
                    stream.write(content)
                with sftp.open(filename, 'rb') as stream:
                    if stream.read() != content:
                        raise ValueError('AUDIT_UPLOAD_READBACK_FAILED')
                if sftp.stat(filename).st_mode & 0o777 != (0o600 if filename == CONFIG else 0o644):
                    raise ValueError('AUDIT_UPLOAD_MODE_INVALID')
        deploy.run(ssh, 'python3 -m py_compile ' + REMOTE + '/collector.py && systemd-analyze verify /etc/systemd/system/gewu-download-audit.service /etc/systemd/system/gewu-download-audit.timer', timeout=30)
        if args.stage_only:
            report = {'ok': True, 'status': 'staged-awaiting-oss-authorization', 'backup': backup,
                      'logBucket': args.log_bucket, 'collector': REMOTE + '/collector.py', 'timerEnabled': False,
                      'collectorSha256': hashlib.sha256(uploads[REMOTE + '/collector.py']).hexdigest()}
            (evidence / 'deployment-staged.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
            print(json.dumps(report))
            return
        deploy.run(ssh, 'systemctl daemon-reload && systemctl enable --now gewu-download-audit.timer && systemctl start gewu-download-audit.service', timeout=190)
        deploy.run(ssh, 'systemctl is-active gewu-download-audit.timer && python3 ' + REMOTE + '/collector.py status', timeout=30)
        report = {'ok': True, 'logBucket': args.log_bucket, 'backup': backup, 'collector': REMOTE + '/collector.py',
                  'timer': 'gewu-download-audit.timer', 'database': config['database']}
        (evidence / 'deployment.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report))
    finally:
        ssh.close()


if __name__ == '__main__':
    main()
