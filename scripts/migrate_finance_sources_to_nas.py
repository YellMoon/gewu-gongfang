"""Stage immutable GWB1 bill objects on NAS without placing plaintext or keys on disk.

This command never removes cloud originals or changes production configuration.
The emitted metadata SQL is a separate, reviewable cutover input.
"""
import argparse,base64,contextlib,hashlib,io,json,os,re,secrets,stat,sys
from datetime import datetime,timezone
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

REFERENCE=re.compile(r'^[a-f0-9]{64}-[a-f0-9]{64}\.enc$')
SOURCE_ROOT='/root/scheduling-data/finance-sources'
MAX_BYTES=24*1024*1024+32
def digest(data):return hashlib.sha256(data).hexdigest()
def checked_reference(name):
    if not isinstance(name,str) or not REFERENCE.fullmatch(name):raise ValueError('FINANCE_SOURCE_NAME_INVALID')
    return name[:-4]
def verify_envelope(reference,raw,key):
    if not REFERENCE.fullmatch(reference+'.enc') or not 33<=len(raw)<=MAX_BYTES or raw[:4]!=b'GWB1':raise ValueError('FINANCE_SOURCE_ENVELOPE_INVALID')
    plain=AESGCM(key).decrypt(raw[4:16],raw[32:]+raw[16:32],reference.encode('ascii'))
    if digest(plain)!=reference[65:]:raise ValueError('FINANCE_SOURCE_PLAINTEXT_HASH_MISMATCH')
    return len(plain)
def write_immutable(path,raw):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists():
        if path.is_symlink() or path.is_junction() or path.read_bytes()!=raw:raise ValueError('FINANCE_NAS_IMMUTABLE_CONFLICT')
        return
    partial=path.parent/(path.name+'.'+secrets.token_hex(8)+'.partial')
    try:
        with partial.open('xb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        if digest(partial.read_bytes())!=digest(raw):raise ValueError('FINANCE_NAS_WRITE_VERIFY_FAILED')
        try:os.rename(partial,path)
        except FileExistsError:
            if path.read_bytes()!=raw:raise ValueError('FINANCE_NAS_IMMUTABLE_CONFLICT')
        if path.read_bytes()!=raw:raise ValueError('FINANCE_NAS_READBACK_FAILED')
    finally:
        if partial.exists():partial.unlink()
def metadata_sql(rows,agent_id):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{2,63}',agent_id):raise ValueError('FINANCE_NAS_AGENT_INVALID')
    statements=['BEGIN;','SET LOCAL ROLE vnext_pg17_business_owner;']
    for row in rows:
        ref=checked_reference(row['referenceId']+'.enc');d=row['descriptor']
        if d['objectId']!='obj_bill_'+digest(ref.encode()) or d['version']!=1 or not re.fullmatch('[a-f0-9]{64}',d['sha256']) or not 33<=d['bytes']<=MAX_BYTES:raise ValueError('FINANCE_NAS_DESCRIPTOR_INVALID')
        statements.append("INSERT INTO business.personal_finance_source_objects(reference_id,object_id,object_version,encrypted_sha256,encrypted_bytes,verified_agent_id) VALUES('%s','%s',1,'%s',%d,'%s') ON CONFLICT(reference_id) DO NOTHING;"%(ref,d['objectId'],d['sha256'],d['bytes'],agent_id))
    statements.append('COMMIT;')
    return '\n'.join(statements)+'\n'
def stage_sources(ssh,nas_root,backup_root,evidence_root,staging_root=None):
    nas_root=Path(nas_root);backup_root=Path(backup_root);evidence_root=Path(evidence_root)
    if not nas_root.is_absolute() or not nas_root.is_dir() or nas_root.is_symlink() or nas_root.is_junction():raise ValueError('FINANCE_NAS_ROOT_INVALID')
    if not backup_root.is_absolute() or backup_root==nas_root or backup_root.is_relative_to(nas_root):raise ValueError('FINANCE_NAS_BACKUP_ROOT_INVALID')
    staging_root=Path(staging_root) if staging_root else nas_root/'finance-migration-20261027'
    if not staging_root.is_relative_to(nas_root) or staging_root==nas_root or staging_root.is_symlink() or staging_root.is_junction():raise ValueError('FINANCE_NAS_STAGING_ROOT_INVALID')
    stdin,stdout,stderr=ssh.exec_command("docker inspect gewu-cloud-business-api --format '{{json .Config.Env}}'",timeout=20)
    env=dict(value.split('=',1) for value in json.loads(stdout.read().decode()) if '=' in value)
    if stdout.channel.recv_exit_status()!=0:raise ValueError('FINANCE_CLOUD_INSPECT_FAILED')
    key=base64.b64decode(env.get('CLOUD_BILL_ARCHIVE_KEY',''),validate=True)
    if len(key)!=32:raise ValueError('FINANCE_CLOUD_KEY_INVALID')
    agent_id=env.get('CLOUD_STORAGE_AGENT_ID','')
    sftp=ssh.open_sftp();rows=[]
    try:
        entries=[e for e in sftp.listdir_attr(SOURCE_ROOT) if REFERENCE.fullmatch(e.filename)]
        snapshot={e.filename:(e.st_size,e.st_mtime) for e in entries}
        for index,e in enumerate(sorted(entries,key=lambda x:x.filename)):
            if not stat.S_ISREG(e.st_mode):raise ValueError('FINANCE_CLOUD_SOURCE_NOT_REGULAR')
            ref=checked_reference(e.filename);source=SOURCE_ROOT+'/'+e.filename
            with sftp.open(source,'rb') as stream:raw=stream.read(MAX_BYTES+1)
            plain_bytes=verify_envelope(ref,raw,key);cipher_hash=digest(raw)
            descriptor={'objectId':'obj_bill_'+digest(ref.encode()),'version':1,'sha256':cipher_hash,'bytes':len(raw)}
            target=nas_root/'objects'/descriptor['objectId']/'1'/cipher_hash
            # Every component is within the explicit NAS byte-storage root.
            for parent in [target.parent,target.parent.parent,target.parent.parent.parent,nas_root/'objects']:
                if parent.exists() and (parent.is_symlink() or parent.is_junction()):raise ValueError('FINANCE_NAS_REPARSE_POINT')
            # The agent's objects/ directory is intentionally not writable over SMB.
            # Stage bytes under its existing mount; only the NAS agent imports objects.
            staged=staging_root/e.filename
            write_immutable(staged,raw);write_immutable(backup_root/e.filename,raw)
            current=sftp.stat(source)
            if (current.st_size,current.st_mtime)!=snapshot[e.filename]:raise ValueError('FINANCE_CLOUD_SOURCE_CHANGED')
            rows.append(dict(referenceId=ref,descriptor=descriptor,plaintextHash=ref[65:],plaintextBytes=plain_bytes,source=source,sourceMtime=e.st_mtime,nasObject=str(target),nasStaged=str(staged),nasBackup=str(backup_root/e.filename)))
            if (index+1)%50==0:print('verified encrypted NAS objects',index+1,flush=True)
        latest={e.filename:(e.st_size,e.st_mtime) for e in sftp.listdir_attr(SOURCE_ROOT) if REFERENCE.fullmatch(e.filename)}
        if latest!=snapshot:raise ValueError('FINANCE_CLOUD_ARCHIVE_INVENTORY_CHANGED')
    finally:sftp.close()
    evidence_root.mkdir(parents=True,exist_ok=True)
    receipt={'ok':True,'phase':'staged-awaiting-nas-object-import-cloud-originals-preserved','files':len(rows),'bytes':sum(r['descriptor']['bytes'] for r in rows),'agentId':agent_id,'nasRoot':str(nas_root),'backupRoot':str(backup_root),'stagingRoot':str(staging_root),'createdAtUtc':datetime.now(timezone.utc).isoformat(),'objects':rows}
    encoded=json.dumps(receipt,ensure_ascii=False,indent=2)
    (evidence_root/'existing-sources-staged.json').write_text(encoded,encoding='utf-8')
    (backup_root/'migration-receipt.json').write_text(encoded,encoding='utf-8')
    (staging_root/'migration-manifest.json').write_text(encoded,encoding='utf-8')
    if json.loads((backup_root/'migration-receipt.json').read_text(encoding='utf-8'))!=receipt:raise ValueError('FINANCE_NAS_RECEIPT_READBACK_FAILED')
    (evidence_root/'existing-sources-metadata.pending.sql').write_text('-- DO NOT APPLY before NAS-side object import and readback verification.\n'+metadata_sql(rows,agent_id),encoding='utf-8')
    return receipt
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--nas-root',required=True);parser.add_argument('--backup-root',required=True);parser.add_argument('--evidence-root',required=True)
    args=parser.parse_args();sys.path.insert(0,str(Path(__file__).parent));import deploy
    with contextlib.redirect_stdout(io.StringIO()):ssh=deploy.connect()
    try:receipt=stage_sources(ssh,args.nas_root,args.backup_root,args.evidence_root)
    finally:ssh.close()
    print(json.dumps({k:v for k,v in receipt.items() if k!='objects'},ensure_ascii=False),flush=True)
if __name__=='__main__':main()
