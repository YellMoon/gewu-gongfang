"""Execute only the reviewed packed-option plan in the current cloud container."""
import argparse
import json
import re
import secrets
from pathlib import Path
import deploy
from plan_question_option_repair import digest
from run_question_duplicate_repair import authority_sha256, verified_backup

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'gewu-cloud-business-api:8.11.6-754229230c89'
PLAN = '2a8868cef1cdadfa2fb06cdc57e233dcdfa06c56203817a09264d2dd6f02046c'
REVIEWED_PLANS = {PLAN: ('packed', 168),
    'ecef0a0bcf3767df94f54f8c98d14f6edf7fea24f841333ac3c67759d4c9c4d9': ('inline', 4)}
FILES = ('repair-question-packed-options.js', 'run-question-packed-option-repair.js',
         'repair-question-formula-identities.js', 'repair-production-question-duplicates.js',
         'real-cloud-business-acceptance.js')


def run(mode, proposal_path, receipt_path):
    if mode not in ('dry-run', 'apply'):
        raise ValueError('OPTION_REPAIR_MODE_INVALID')
    source = Path(proposal_path).resolve(strict=True)
    destination = Path(receipt_path).resolve()
    backup_path = destination.with_suffix('.backup.json')
    if destination.exists() or backup_path.exists():
        raise ValueError('OPTION_REPAIR_RECEIPT_EXISTS')
    proposal = json.loads(source.read_text(encoding='utf-8'))
    plan_hash = proposal.get('planHash')
    kind, count = REVIEWED_PLANS.get(plan_hash, ('invalid', -1))
    if (proposal.get('mode') != 'offline-proposal-only' or kind == 'invalid'
            or len(proposal.get('entries', [])) != count or digest(proposal['entries']) != plan_hash):
        raise ValueError('OPTION_REPAIR_PLAN_INVALID')
    nonce = secrets.token_hex(16)
    remote, target = f'/tmp/gewu-option-repair-{nonce}', f'/app/question-repair-{nonce}'
    assert re.fullmatch(r'/tmp/gewu-option-repair-[a-f0-9]{32}', remote)
    assert re.fullmatch(r'/app/question-repair-[a-f0-9]{32}', target)
    ssh = deploy.connect()
    staged = created = False
    try:
        deploy.run(ssh, f'test "$(docker inspect -f \'{{{{.Config.Image}}}}\' gewu-cloud-business-api)" = \'{IMAGE}\'')
        backup = verified_backup() if mode == 'apply' else None
        if backup:
            with backup_path.open('x', encoding='utf-8') as handle:
                json.dump(backup, handle, ensure_ascii=True)
        deploy.run(ssh, f"test ! -e '{remote}' && mkdir -m 700 '{remote}'")
        staged = True
        deploy.run(ssh, f"docker exec -u 0 gewu-cloud-business-api mkdir -m 755 '{target}'")
        created = True
        uploads = [(ROOT / 'scripts' / name, name) for name in FILES] + [(source, 'reviewed-proposals.json')]
        if backup:
            uploads.append((backup_path, 'verified-backup.json'))
        sftp = ssh.open_sftp()
        try:
            for local, name in uploads:
                sftp.put(str(local), f'{remote}/{name}')
        finally:
            sftp.close()
        for _, name in uploads:
            deploy.run(ssh, f"docker cp '{remote}/{name}' gewu-cloud-business-api:'{target}/{name}'")
        flag = ' --apply' if mode == 'apply' else ''
        output, _ = deploy.run(ssh,
            f"docker exec -e GEWU_OPTION_REPAIR_KIND={kind} -e EXPECTED_CLOUD_VERSION=8.11.6 -e EXPECTED_QUESTION_AUTHORITY_SHA256={authority_sha256()} "
            f"gewu-cloud-business-api node '{target}/run-question-packed-option-repair.js'{flag}", timeout=180)
        result = json.loads(output.strip().splitlines()[-1])
        if (result.get('ok') is not True or result.get('mode') != mode or result.get('planHash') != plan_hash
                or result.get('questionCount') != count or result.get('unchangedFieldsVerified') is not True
                or result.get('receiptCount') != (count if mode == 'apply' else 0)):
            raise ValueError('OPTION_REPAIR_RECEIPT_INVALID')
        with destination.open('x', encoding='utf-8') as handle:
            json.dump(result, handle, ensure_ascii=True, indent=2)
        return result
    finally:
        try:
            if created:
                deploy.run(ssh, f"docker exec -u 0 gewu-cloud-business-api rm -rf -- '{target}'")
        finally:
            try:
                if staged:
                    deploy.run(ssh, f"rm -rf -- '{remote}'")
            finally:
                ssh.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('dry-run', 'apply'))
    parser.add_argument('--proposal', required=True)
    parser.add_argument('--receipt', required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.mode, args.proposal, args.receipt), ensure_ascii=True))
