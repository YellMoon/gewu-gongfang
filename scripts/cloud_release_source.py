"""Pin cloud image and SQL inputs without modifying or registering a worktree."""
import contextlib
import hashlib
import io
import pathlib
import re
import subprocess
import tarfile
import tempfile


SOURCE_PATHS = ('cloud-business-api', 'shared', 'scripts', 'backend/assets/fonts',
                'package.json', 'miniapp/package.json', 'storage-agent/package.json',
                'config/release-compatibility.json')


def archive_bytes(repo, commit):
    return subprocess.run(
        ['git', 'archive', '--format=tar', commit, '--', *SOURCE_PATHS],
        cwd=repo, check=True, capture_output=True, timeout=60,
    ).stdout


@contextlib.contextmanager
def frozen_cloud_inputs(repo, revision):
    if not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{7,40}', revision):
        raise ValueError('CLOUD_RELEASE_SOURCE_REVISION_INVALID')
    commit = subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], cwd=repo, text=True, encoding='utf-8', timeout=15,
    ).strip()
    if not re.fullmatch(r'[0-9a-f]{40}', commit) or not commit.startswith(revision):
        raise ValueError('CLOUD_RELEASE_SOURCE_HEAD_MISMATCH')
    payload = archive_bytes(repo, commit)
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:') as archive:
        for member in archive.getmembers():
            name = pathlib.PurePosixPath(member.name)
            allowed = any(member.name.rstrip('/') == prefix or member.name.startswith(prefix + '/')
                          or (member.isdir() and prefix.startswith(member.name.rstrip('/') + '/'))
                          for prefix in SOURCE_PATHS)
            if (name.is_absolute() or '..' in name.parts or '\\' in member.name or ':' in member.name
                    or not allowed or not (member.isfile() or member.isdir())):
                raise ValueError('CLOUD_RELEASE_SOURCE_ARCHIVE_INVALID')
        with tempfile.TemporaryDirectory(prefix='gewu-release-source-') as folder:
            root = pathlib.Path(folder)
            archive.extractall(root, filter='data')
            for member in archive.getmembers():
                if not member.isfile() or member.size > 1024:
                    continue
                target = root / member.name
                pointer = re.fullmatch(rb'version https://git-lfs.github.com/spec/v1\r?\n'
                                       rb'oid sha256:([0-9a-f]{64})\r?\nsize ([0-9]+)\r?\n?', target.read_bytes())
                if not pointer:
                    continue
                local = pathlib.Path(repo).resolve() / member.name
                if not local.is_file() or not local.resolve().is_relative_to(pathlib.Path(repo).resolve()):
                    raise ValueError('CLOUD_RELEASE_SOURCE_LFS_INVALID')
                content = local.read_bytes()
                if len(content) != int(pointer[2]) or hashlib.sha256(content).hexdigest().encode('ascii') != pointer[1]:
                    raise ValueError('CLOUD_RELEASE_SOURCE_LFS_INVALID')
                target.write_bytes(content)
            yield root
