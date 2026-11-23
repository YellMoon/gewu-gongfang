import contextlib
import datetime as dt
import io
import json
import os
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    os.environ['APP_ENV'] = 'prod'
    sys.path.insert(0, str(ROOT / 'scripts'))
    import deploy
    import configure_oss_download_audit as configuration
    logging = ET.fromstring(configuration.require(configuration.request('GET', configuration.SOURCE, 'logging'), 'VERIFY_LOGGING'))
    if (logging.findtext('LoggingEnabled/TargetBucket') != configuration.TARGET
            or logging.findtext('LoggingEnabled/TargetPrefix') != 'access/'):
        raise ValueError('OSS_LOGGING_TARGET_MISMATCH')
    anonymous_status = None
    try:
        with urllib.request.urlopen(f'https://{configuration.TARGET}.oss-cn-beijing.aliyuncs.com/?prefix=access%2F&max-keys=1', timeout=20) as response:
            anonymous_status = response.status
    except urllib.error.HTTPError as error:
        anonymous_status = error.code
    if anonymous_status != 403:
        raise ValueError('AUDIT_BUCKET_ANONYMOUS_ACCESS_NOT_BLOCKED')
    setup_permission_status, _ = configuration.request('GET', configuration.TARGET, 'bucketInfo')
    if setup_permission_status != 403:
        raise ValueError('AUDIT_SETUP_PERMISSION_STILL_PRESENT')
    with contextlib.redirect_stdout(io.StringIO()):
        ssh = deploy.connect()
    try:
        deploy.run(ssh, 'systemctl start gewu-download-audit.service', timeout=190)
        _, stdout, stderr = ssh.exec_command('systemctl is-active gewu-download-audit.timer; systemctl show gewu-download-audit.service -p Result --value; stat -c %a /etc/gewu-download-audit.json', timeout=20)
        values = stdout.read().decode('utf-8').splitlines()
        if stdout.channel.recv_exit_status() != 0 or values != ['active', 'success', '600']:
            raise ValueError('AUDIT_SERVICE_VERIFICATION_FAILED')
        month = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime('%Y-%m')
        _, stdout, stderr = ssh.exec_command('python3 /opt/gewu-download-audit/collector.py report --month ' + month + ' --details --limit 100', timeout=30)
        report = json.loads(stdout.read().decode('utf-8'))
        if stdout.channel.recv_exit_status() != 0:
            raise ValueError('AUDIT_REPORT_FAILED')
        receipt = {'ok': True, 'verifiedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                   'loggingEnabled': True, 'anonymousLogBucketStatus': anonymous_status,
                   'timer': 'active', 'collectorResult': 'success', 'credentialFileMode': '600',
                   'setupInfoPermissionRemoved': True,
                   'month': month, 'lastImportAt': report['last_import_at'], 'observedRequests': report['requests'],
                   'firstLogDelivery': 'received' if report['last_import_at'] else 'pending'}
        evidence = ROOT / 'output' / 'oss-download-audit'
        evidence.mkdir(parents=True, exist_ok=True)
        (evidence / 'verification.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
        (evidence / 'latest-monthly-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(receipt))
    finally:
        ssh.close()


if __name__ == '__main__':
    main()
