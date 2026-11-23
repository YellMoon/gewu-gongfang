import gzip
import importlib.util
import json
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('oss_download_audit', Path(__file__).with_name('oss_download_audit.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def line(request_id='request-12345678', when='01/Nov/2026:00:01:00 +0800', method='GET', status=200, sent=120, size=120, key='desktop/app-8.41.0.exe', query='', agent='electron-updater/1.0'):
    values = ['192.0.2.1', '-', '-', '[' + when + ']',
              json.dumps(f'{method} /{key}{query} HTTP/1.1'), str(status), str(sent), '127',
              '"-"', json.dumps(agent), '"bucket.oss-cn-beijing.aliyuncs.com"', json.dumps(request_id),
              '"true"', '"-"', '"GetObject"', '"gewu-staging-edu"', json.dumps(key), str(size),
              '88', '"-"', '302', '"owner"', '-', '"-"', '"standard"', '"-"', '"-"', '"sensitive-key"']
    return ' '.join(values)


record = audit.parse_record(line(query='?x-gewu-source=release-verification&Signature=secret'), 'gewu-staging-edu')
assert record['occurred_at'] == '2026-10-31T16:01:00+00:00'
assert record['declared_source'] == 'release-verification'
assert not any(value in json.dumps(record) for value in ['192.0.2.1', 'Signature', 'sensitive-key', 'secret'])
assert audit.parse_record(line(key='private/finance.pdf'), 'gewu-staging-edu') is None
assert audit.parse_record(line(), 'another-bucket') is None
assert audit.parse_record(line() + ' "new-field" "another-field"', 'gewu-staging-edu')['sent_bytes'] == 120
for invalid in ['bad line', line(sent=-1), line(request_id='-')]:
    try:
        audit.parse_record(invalid, 'gewu-staging-edu')
        raise AssertionError('invalid log accepted')
    except ValueError:
        pass

with tempfile.TemporaryDirectory() as directory:
    database = audit.open_database(str(Path(directory) / 'audit.sqlite3'))
    records = [line(), line(request_id='request-22345678', status=206, sent=20),
               line(request_id='request-32345678', method='HEAD', sent=0),
               line(request_id='request-42345678', when='31/Oct/2026:23:59:59 +0800', status=404, sent=10),
               line(request_id='request-52345678', key='desktop/latest.yml', sent=50, size=50)]
    payload = ('\n'.join(records) + '\n').encode()
    first = audit.ingest(database, payload, 'gewu-staging-edu', 'access/one', 'etag')
    assert first['inserted'] == 5
    assert audit.ingest(database, gzip.compress(payload), 'gewu-staging-edu', 'access/two', 'etag')['inserted'] == 0
    november = audit.report(database, '2026-11', details=True)
    assert november['requests'] == 4 and november['bytes_sent'] == 190
    installer = next(item for item in november['objects'] if item['kind'] == 'installer')
    assert installer['successful_get_responses'] == 2
    assert installer['full_object_responses'] == 1
    assert installer['range_responses'] == 1 and installer['head_requests'] == 1
    assert len(november['details']) == 4
    assert audit.report(database, '2026-10')['requests'] == 1
    try:
        audit.ingest(database, b'invalid', 'gewu-staging-edu', 'access/bad', 'etag')
        raise AssertionError('parse failure ignored')
    except ValueError:
        assert database.execute("SELECT COUNT(*) FROM imports WHERE object_key='access/bad'").fetchone()[0] == 0
    class FakeClient:
        def objects(self):
            yield 'access/new', 'new-etag'
        def get(self, key):
            return payload
    assert audit.collect({'source_bucket': 'gewu-staging-edu'}, database, FakeClient())['files'] == 1
    assert audit.collect({'source_bucket': 'gewu-staging-edu'}, database, FakeClient())['files'] == 0
    database.close()

print('OSS download audit checks passed')
