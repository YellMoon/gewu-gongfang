"""Execute the reviewed metadata-only repair in the existing cloud authority container."""
import argparse
import json
import re
import secrets
from pathlib import Path
import deploy
from run_question_duplicate_repair import authority_sha256, verified_backup

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'gewu-cloud-business-api:8.11.5-a9d4e66ca5e5'
PLAN = 'cb112c545c2f9973556b2101a54b5d37c3c9525feb25eb6d288ed0f41a6a2e2e'
FILES = ('repair-question-formula-identities.js', 'run-question-formula-repair.js',
         'repair-production-question-duplicates.js', 'real-cloud-business-acceptance.js')


def validate_receipt(value, mode):
    if (not isinstance(value, dict) or value.get('ok') is not True or value.get('mode') != mode
            or value.get('planHash') != PLAN or value.get('questionCount') != 82
            or value.get('identityCount') != 126 or value.get('unchangedFieldsVerified') is not True
            or value.get('receiptCount') != (82 if mode == 'apply' else 0)):
        raise ValueError('FORMULA_REPAIR_RECEIPT_INVALID')
    return value


def run(mode, originals, receipt_path):
    if mode not in ('dry-run', 'apply'):
        raise ValueError('FORMULA_REPAIR_MODE_INVALID')
    original_path = Path(originals).resolve(strict=True)
    destination = Path(receipt_path).resolve()
    backup_path = destination.with_suffix('.backup.json')
    if destination.exists() or backup_path.exists():
        raise ValueError('FORMULA_REPAIR_RECEIPT_ALREADY_EXISTS')
    rows = json.loads(original_path.read_text(encoding='utf-8'))
    if (not isinstance(rows, list) or len(rows) != 86
            or any(not re.fullmatch(r'question-import-[a-f0-9]{40}', row.get('id', '')) for row in rows)):
        raise ValueError('FORMULA_REPAIR_SCOPE_INVALID')
    nonce = secrets.token_hex(16)
    remote = f'/tmp/gewu-formula-repair-{nonce}'
    container_dir = f'/app/question-repair-{nonce}'
    assert re.fullmatch(r'/tmp/gewu-formula-repair-[a-f0-9]{32}', remote)
    assert re.fullmatch(r'/app/question-repair-[a-f0-9]{32}', container_dir)
    ssh = deploy.connect()
    staged = container_created = False
    try:
        deploy.run(ssh, f'test "$(docker inspect -f \'{{{{.Config.Image}}}}\' gewu-cloud-business-api)" = \'{IMAGE}\'')
        backup = verified_backup() if mode == 'apply' else None
        if backup:
            # Save the rollback location before any production mutation, including on failure.
            backup_path.write_text(json.dumps(backup, ensure_ascii=True, sort_keys=True), encoding='utf-8')
        deploy.run(ssh, f"test ! -e '{remote}' && mkdir -m 700 '{remote}'")
        staged = True
        deploy.run(ssh, f"docker exec -u 0 gewu-cloud-business-api mkdir -m 755 '{container_dir}'")
        container_created = True
        uploads = [(ROOT / 'scripts' / name, name) for name in FILES]
        uploads.append((original_path, 'reviewed-originals.json'))
        if backup:
            uploads.append((backup_path, 'verified-backup.json'))
        sftp = ssh.open_sftp()
        try:
            for local, name in uploads:
                sftp.put(str(local), f'{remote}/{name}')
        finally:
            sftp.close()
        for _, name in uploads:
            deploy.run(ssh, f"docker cp '{remote}/{name}' gewu-cloud-business-api:'{container_dir}/{name}'")
        flag = ' --apply' if mode == 'apply' else ''
        output, _ = deploy.run(ssh,
            f"docker exec -e EXPECTED_CLOUD_VERSION=8.11.5 -e EXPECTED_QUESTION_AUTHORITY_SHA256={authority_sha256()} "
            f"gewu-cloud-business-api node '{container_dir}/run-question-formula-repair.js'{flag}", timeout=300)
        result = validate_receipt(json.loads(output.strip().splitlines()[-1]), mode)
        destination.write_text(json.dumps(result, ensure_ascii=True, indent=2), encoding='utf-8')
        return result
    finally:
        try:
            if container_created:
                deploy.run(ssh, f"docker exec -u 0 gewu-cloud-business-api rm -rf -- '{container_dir}'")
        finally:
            try:
                if staged:
                    deploy.run(ssh, f"rm -rf -- '{remote}'")
            finally:
                ssh.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('dry-run', 'apply'))
    parser.add_argument('--originals', required=True)
    parser.add_argument('--receipt', required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.mode, args.originals, args.receipt), ensure_ascii=True))
