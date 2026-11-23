import argparse
import base64
import datetime as dt
import email.utils
import hashlib
import hmac
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'gewu-staging-edu'
TARGET = 'gewu-download-audit-1079575960473975'
LIFECYCLE = '<LifecycleConfiguration><Rule><ID>expire-download-access-logs</ID><Prefix>access/</Prefix><Status>Enabled</Status><Expiration><Days>90</Days></Expiration></Rule></LifecycleConfiguration>'
LOGGING = f'<BucketLoggingStatus><LoggingEnabled><TargetBucket>{TARGET}</TargetBucket><TargetPrefix>access/</TargetPrefix></LoggingEnabled></BucketLoggingStatus>'


def request(method, bucket, resource='', body=None, acl=None):
    if bucket not in {SOURCE, TARGET}:
        raise ValueError('OSS_AUDIT_SCOPE_INVALID')
    date = email.utils.formatdate(usegmt=True)
    payload = body.encode('utf-8') if body is not None else None
    content_type = 'application/xml' if payload is not None else ''
    digest = base64.b64encode(hashlib.md5(payload).digest()).decode() if payload is not None else ''
    custom = f'x-oss-acl:{acl}\n' if acl else ''
    canonical = f'{method}\n{digest}\n{content_type}\n{date}\n{custom}/{bucket}/' + ('?' + resource if resource else '')
    secret = os.environ.get('OSS_ACCESS_KEY_SECRET') or os.environ.get('ALIYUN_ACCESS_KEY_SECRET')
    key = os.environ.get('OSS_ACCESS_KEY_ID') or os.environ.get('ALIYUN_ACCESS_KEY_ID')
    if not key or not secret:
        raise ValueError('OSS_AUDIT_CREDENTIAL_UNAVAILABLE')
    signature = base64.b64encode(hmac.new(secret.encode(), canonical.encode(), hashlib.sha1).digest()).decode()
    headers = {'Date': date, 'Authorization': f'OSS {key}:{signature}'}
    if payload is not None:
        headers.update({'Content-Type': content_type, 'Content-MD5': digest})
    if acl:
        headers['x-oss-acl'] = acl
    url = f'https://{bucket}.oss-cn-beijing.aliyuncs.com/' + ('?' + resource if resource else '')
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=payload, method=method, headers=headers), timeout=30) as response:
            return response.status, response.read(1024 * 1024).decode('utf-8')
    except urllib.error.HTTPError as error:
        return error.code, error.read(1024 * 1024).decode('utf-8')


def require(result, operation):
    status, body = result
    if not 200 <= status < 300:
        try:
            code = ET.fromstring(body).findtext('Code')
        except ET.ParseError:
            code = 'unknown'
        raise ValueError(f'{operation}:{status}:{code}')
    return body


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    from dotenv import load_dotenv
    load_dotenv(ROOT / '.env.local', override=False)
    os.umask(0o077)
    status, logging_before = request('GET', SOURCE, 'logging')
    require((status, logging_before), 'GET_LOGGING')
    existing = ET.fromstring(logging_before).findtext('LoggingEnabled/TargetBucket')
    if existing and existing != TARGET:
        raise ValueError('EXISTING_LOGGING_TARGET_REQUIRES_REVIEW')
    target_status, target_before = request('GET', TARGET, 'bucketInfo')
    if target_status not in {200, 404}:
        require((target_status, target_before), 'GET_BUCKET_INFO')
    if target_status == 200:
        info = ET.fromstring(target_before)
        if info.findtext('.//AccessControlList/Grant') != 'private':
            raise ValueError('AUDIT_BUCKET_MUST_BE_PRIVATE')
    evidence = ROOT / 'output' / 'oss-download-audit'
    evidence.mkdir(parents=True, exist_ok=True)
    before = {'observedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'logging': logging_before,
              'targetExists': target_status == 200, 'targetInfo': target_before if target_status == 200 else None}
    snapshot = evidence / ('oss-before-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S') + '.json')
    snapshot.write_text(json.dumps(before, indent=2), encoding='utf-8')
    if not args.apply:
        print(json.dumps({'source': SOURCE, 'target': TARGET, 'snapshot': str(snapshot), 'mode': 'preview'}))
        return
    if target_status == 404:
        require(request('PUT', TARGET, acl='private'), 'CREATE_PRIVATE_BUCKET')
    info_body = require(request('GET', TARGET, 'bucketInfo'), 'VERIFY_PRIVATE_BUCKET')
    if ET.fromstring(info_body).findtext('.//AccessControlList/Grant') != 'private':
        raise ValueError('AUDIT_BUCKET_PRIVACY_VERIFICATION_FAILED')
    lifecycle_status, lifecycle_before = request('GET', TARGET, 'lifecycle')
    if lifecycle_status not in {200, 404}:
        require((lifecycle_status, lifecycle_before), 'GET_LIFECYCLE')
    if lifecycle_status == 200:
        rules = ET.fromstring(lifecycle_before).findall('Rule')
        if len(rules) != 1 or rules[0].findtext('ID') != 'expire-download-access-logs':
            raise ValueError('EXISTING_LIFECYCLE_REQUIRES_REVIEW')
    require(request('PUT', TARGET, 'lifecycle', LIFECYCLE), 'SET_LOG_RETENTION')
    require(request('PUT', SOURCE, 'logging', LOGGING), 'ENABLE_ACCESS_LOGGING')
    logging = ET.fromstring(require(request('GET', SOURCE, 'logging'), 'VERIFY_LOGGING'))
    lifecycle = ET.fromstring(require(request('GET', TARGET, 'lifecycle'), 'VERIFY_RETENTION'))
    if (logging.findtext('LoggingEnabled/TargetBucket') != TARGET
            or logging.findtext('LoggingEnabled/TargetPrefix') != 'access/'
            or lifecycle.findtext('Rule/Expiration/Days') != '90'):
        raise ValueError('OSS_AUDIT_CONFIGURATION_MISMATCH')
    result = {'ok': True, 'source': SOURCE, 'target': TARGET, 'targetAcl': 'private', 'prefix': 'access/',
              'rawRetentionDays': 90, 'configuredAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'snapshot': str(snapshot)}
    (evidence / 'oss-configuration.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
