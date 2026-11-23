import argparse
import contextlib
import datetime as dt
import email.utils
import gzip
import hashlib
import hmac
import json
import os
import re
import sqlite3
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

MAX_LOG_BYTES = 64 * 1024 * 1024
BEIJING = dt.timezone(dt.timedelta(hours=8))
SOURCES = {'desktop-update', 'release-verification', 'manual', 'audit-probe'}


def parse_record(line, source_bucket):
    fields = re.findall(r'\[[^\]]+\]|"(?:\\.|[^"\\])*"|[^\s]+', line)
    if len(fields) < 19:
        raise ValueError('OSS_LOG_FIELDS_INVALID')
    fields = [json.loads(value) if value.startswith('"') else value for value in fields]
    if fields[15] != source_bucket:
        return None
    method, target, protocol = fields[4].split(' ', 2)
    if not protocol.startswith('HTTP/'):
        raise ValueError('OSS_LOG_REQUEST_INVALID')
    key = fields[16]
    if not key.startswith('desktop/'):
        return None
    timestamp = dt.datetime.strptime(fields[3], '[%d/%b/%Y:%H:%M:%S %z]').astimezone(dt.timezone.utc).isoformat()
    status, sent_bytes = int(fields[5]), int(fields[6])
    object_bytes = None if fields[17] == '-' else int(fields[17])
    if sent_bytes < 0 or (object_bytes is not None and object_bytes < 0) or not 100 <= status <= 599:
        raise ValueError('OSS_LOG_NUMBERS_INVALID')
    request_id = fields[11]
    if not re.fullmatch(r'[A-Za-z0-9-]{8,160}', request_id):
        raise ValueError('OSS_LOG_REQUEST_ID_INVALID')
    declared = urllib.parse.parse_qs(urllib.parse.urlsplit(target).query).get('x-gewu-source', ['unknown'])[0]
    declared = declared if declared in SOURCES else 'unknown'
    agent = fields[9].lower()
    client = 'audit-probe' if 'gewudownloadauditprobe/' in agent else 'release-verifier' if 'gewureleaseverifier/' in agent else 'electron-updater' if 'electron-updater' in agent else 'browser' if 'mozilla/' in agent else 'curl' if 'curl/' in agent else 'unknown'
    kind = 'installer' if key.endswith('.exe') else 'blockmap' if key.endswith('.blockmap') else 'update-feed' if key.endswith('.yml') else 'other'
    return {'request_id': request_id, 'occurred_at': timestamp, 'object_key': key, 'method': method,
            'status': status, 'sent_bytes': sent_bytes, 'object_bytes': object_bytes,
            'kind': kind, 'declared_source': declared, 'client_family': client}


def open_database(filename):
    Path(filename).parent.mkdir(parents=True, exist_ok=True)
    database = sqlite3.connect(filename, timeout=30)
    database.execute('PRAGMA journal_mode=WAL')
    database.executescript('''
        CREATE TABLE IF NOT EXISTS requests (
            request_id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, object_key TEXT NOT NULL,
            method TEXT NOT NULL, status INTEGER NOT NULL, sent_bytes INTEGER NOT NULL,
            object_bytes INTEGER, kind TEXT NOT NULL, declared_source TEXT NOT NULL, client_family TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS requests_time ON requests(occurred_at);
        CREATE TABLE IF NOT EXISTS imports (
            object_key TEXT PRIMARY KEY, etag TEXT NOT NULL, imported_at TEXT NOT NULL,
            parsed_rows INTEGER NOT NULL, rejected_rows INTEGER NOT NULL
        );
    ''')
    return database


def ingest(database, payload, source_bucket, object_key, etag):
    if len(payload) > MAX_LOG_BYTES:
        raise ValueError('OSS_LOG_TOO_LARGE')
    if payload.startswith(b'\x1f\x8b'):
        import io
        with gzip.GzipFile(fileobj=io.BytesIO(payload)) as stream:
            payload = stream.read(MAX_LOG_BYTES + 1)
        if len(payload) > MAX_LOG_BYTES:
            raise ValueError('OSS_LOG_TOO_LARGE')
    rows, rejected = [], 0
    for line in payload.decode('utf-8', errors='strict').splitlines():
        if not line.strip():
            continue
        try:
            record = parse_record(line, source_bucket)
            if record:
                rows.append(record)
        except (ValueError, IndexError, TypeError):
            rejected += 1
    if rejected:
        raise ValueError(f'OSS_LOG_PARSE_REJECTED:{rejected}')
    before = database.total_changes
    with database:
        database.executemany('INSERT OR IGNORE INTO requests VALUES (:request_id,:occurred_at,:object_key,:method,:status,:sent_bytes,:object_bytes,:kind,:declared_source,:client_family)', rows)
        inserted = database.total_changes - before
        database.execute('INSERT OR REPLACE INTO imports VALUES (?,?,?,?,?)',
                         (object_key, etag, dt.datetime.now(dt.timezone.utc).isoformat(), len(rows), rejected))
    return {'parsed': len(rows), 'inserted': inserted, 'rejected': rejected}


class OssClient:
    def __init__(self, config):
        self.config = config

    def get(self, key='', query=None):
        import base64
        config = self.config
        date = email.utils.formatdate(usegmt=True)
        canonical = f"GET\n\n\n{date}\n/{config['log_bucket']}/{key}"
        signature = base64.b64encode(hmac.new(config['access_key_secret'].encode(), canonical.encode(), hashlib.sha1).digest()).decode()
        endpoint = config.get('endpoint', 'oss-cn-beijing-internal.aliyuncs.com')
        if not re.fullmatch(r'oss-cn-beijing(?:-internal)?\.aliyuncs\.com', endpoint):
            raise ValueError('OSS_AUDIT_ENDPOINT_INVALID')
        url = f"https://{config['log_bucket']}.{endpoint}/{urllib.parse.quote(key, safe='/')}"
        if query:
            url += '?' + urllib.parse.urlencode(query)
        request = urllib.request.Request(url, headers={'Date': date, 'Authorization': f"OSS {config['access_key_id']}:{signature}"})
        with urllib.request.urlopen(request, timeout=30) as response:
            content = response.read(MAX_LOG_BYTES + 1)
        if len(content) > MAX_LOG_BYTES:
            raise ValueError('OSS_LOG_TOO_LARGE')
        return content

    def objects(self):
        marker = ''
        while True:
            query = {'prefix': self.config.get('log_prefix', 'access/'), 'max-keys': '1000'}
            if marker:
                query['marker'] = marker
            root = ET.fromstring(self.get(query=query))
            for item in root.findall('Contents'):
                yield item.findtext('Key'), item.findtext('ETag')
            if root.findtext('IsTruncated') != 'true':
                return
            next_marker = root.findtext('NextMarker')
            if not next_marker or next_marker == marker:
                raise ValueError('OSS_LOG_PAGINATION_INVALID')
            marker = next_marker


def collect(config, database, client=None):
    client = client or OssClient(config)
    results = {'files': 0, 'inserted': 0, 'errors': []}
    for key, etag in client.objects():
        if not key.startswith(config.get('log_prefix', 'access/')):
            raise ValueError('OSS_LOG_PREFIX_INVALID')
        previous = database.execute('SELECT etag FROM imports WHERE object_key=?', (key,)).fetchone()
        if previous and previous[0] == etag:
            continue
        try:
            result = ingest(database, client.get(key), config['source_bucket'], key, etag)
            results['files'] += 1
            results['inserted'] += result['inserted']
        except Exception as error:
            results['errors'].append({'object': key, 'error': type(error).__name__})
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=400)).isoformat()
    with database:
        database.execute('DELETE FROM requests WHERE occurred_at<?', (cutoff,))
        database.execute('DELETE FROM imports WHERE imported_at<?', (cutoff,))
    return results


def report(database, month, details=False, limit=100):
    if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month):
        raise ValueError('AUDIT_MONTH_INVALID')
    start = dt.datetime.strptime(month, '%Y-%m').replace(tzinfo=BEIJING)
    end = (start.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    bounds = (start.astimezone(dt.timezone.utc).isoformat(), end.astimezone(dt.timezone.utc).isoformat())
    database.row_factory = sqlite3.Row
    rows = database.execute('''SELECT object_key,kind,declared_source,client_family,
        COUNT(*) AS requests, SUM(method='HEAD') AS head_requests,
        SUM(method='GET' AND status BETWEEN 200 AND 299) AS successful_get_responses,
        SUM(method='GET' AND status=200 AND object_bytes>0 AND sent_bytes=object_bytes) AS full_object_responses,
        SUM(method='GET' AND status=206) AS range_responses,
        SUM(status>=400) AS error_responses,SUM(sent_bytes) AS bytes_sent,
        MIN(occurred_at) AS first_at,MAX(occurred_at) AS last_at
        FROM requests WHERE occurred_at>=? AND occurred_at<?
        GROUP BY object_key,kind,declared_source,client_family ORDER BY bytes_sent DESC''', bounds).fetchall()
    last_import = database.execute('SELECT MAX(imported_at) FROM imports').fetchone()[0]
    result = {'month': month, 'timezone': 'Asia/Shanghai', 'last_import_at': last_import,
              'coverage': 'observed-oss-log-records-only', 'bytes_sent': sum(row['bytes_sent'] for row in rows),
              'requests': sum(row['requests'] for row in rows), 'objects': [dict(row) for row in rows]}
    if details:
        if not 1 <= limit <= 1000:
            raise ValueError('AUDIT_LIMIT_INVALID')
        records = database.execute('SELECT * FROM requests WHERE occurred_at>=? AND occurred_at<? ORDER BY occurred_at DESC LIMIT ?', (*bounds, limit)).fetchall()
        result['details'] = [dict(row) for row in records]
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['collect', 'report', 'status'])
    parser.add_argument('--config', default='/etc/gewu-download-audit.json')
    parser.add_argument('--month', default=dt.datetime.now(BEIJING).strftime('%Y-%m'))
    parser.add_argument('--details', action='store_true')
    parser.add_argument('--limit', type=int, default=100)
    args = parser.parse_args()
    os.umask(0o077)
    config = json.loads(Path(args.config).read_text(encoding='utf-8'))
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', config['log_bucket']) or config['source_bucket'] == config['log_bucket']:
        raise ValueError('OSS_AUDIT_BUCKET_INVALID')
    with contextlib.closing(open_database(config['database'])) as database:
        if args.command == 'collect':
            result = collect(config, database)
        elif args.command == 'report':
            result = report(database, args.month, args.details, args.limit)
        else:
            result = {'records': database.execute('SELECT COUNT(*) FROM requests').fetchone()[0],
                      'imported_files': database.execute('SELECT COUNT(*) FROM imports').fetchone()[0],
                      'last_import_at': database.execute('SELECT MAX(imported_at) FROM imports').fetchone()[0]}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.command == 'collect' and result['errors']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
