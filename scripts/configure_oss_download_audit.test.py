import contextlib
import importlib.util
import io
import json
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('configure_oss_download_audit', Path(__file__).with_name('configure_oss_download_audit.py'))
configurator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configurator)
original_root, original_argv = configurator.ROOT, sys.argv[:]


def scenario(*, existing_target=None, private=True):
    calls = []
    state = {'created': False, 'configured': False, 'lifecycle': False}
    def request(method, bucket, resource='', body=None, acl=None):
        calls.append((method, bucket, resource, body, acl))
        if resource == 'logging' and method == 'GET':
            if state['configured']:
                return 200, configurator.LOGGING
            if existing_target:
                return 200, f'<BucketLoggingStatus><LoggingEnabled><TargetBucket>{existing_target}</TargetBucket></LoggingEnabled></BucketLoggingStatus>'
            return 200, '<BucketLoggingStatus/>'
        if resource == 'bucketInfo':
            if not state['created']:
                return 404, '<Error><Code>NoSuchBucket</Code></Error>'
            return 200, '<BucketInfo><Bucket><AccessControlList><Grant>' + ('private' if private else 'public-read') + '</Grant></AccessControlList></Bucket></BucketInfo>'
        if method == 'PUT' and not resource:
            assert acl == 'private'
            state['created'] = True
            return 200, ''
        if resource == 'lifecycle':
            if method == 'PUT':
                state['lifecycle'] = True
                return 200, ''
            return (200, configurator.LIFECYCLE) if state['lifecycle'] else (404, '<Error><Code>NoSuchLifecycle</Code></Error>')
        if resource == 'logging' and method == 'PUT':
            assert state['lifecycle'], 'retention must be configured before logging'
            state['configured'] = True
            return 200, ''
        raise AssertionError('Unexpected OSS operation')
    return request, calls


try:
    for existing_target, private in [(None, True), ('another-log-bucket', True), (None, False)]:
        with tempfile.TemporaryDirectory() as directory:
            configurator.ROOT = Path(directory)
            request, calls = scenario(existing_target=existing_target, private=private)
            configurator.request = request
            sys.argv = ['configure', '--apply']
            with contextlib.redirect_stdout(io.StringIO()):
                try:
                    configurator.main()
                    assert existing_target is None and private
                    receipt = json.loads((Path(directory) / 'output/oss-download-audit/oss-configuration.json').read_text(encoding='utf-8'))
                    assert receipt['targetAcl'] == 'private' and receipt['rawRetentionDays'] == 90
                    assert any((Path(directory) / 'output/oss-download-audit').glob('oss-before-*.json'))
                except ValueError:
                    assert existing_target is not None or not private
                    assert not any(method == 'PUT' and resource == 'logging' for method, bucket, resource, body, acl in calls)
finally:
    configurator.ROOT = original_root
    sys.argv = original_argv

print('OSS audit configuration checks passed')
