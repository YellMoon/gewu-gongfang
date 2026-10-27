import importlib.util,unittest,hashlib,tempfile
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
spec=importlib.util.spec_from_file_location('migration',Path(__file__).with_name('migrate_finance_sources_to_nas.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class MigrationTests(unittest.TestCase):
    def test_legacy_encrypted_envelope_and_scope_binding(self):
        key=b'k'*32;data=b'private original';ref='a'*64+'-'+hashlib.sha256(data).hexdigest();nonce=b'n'*12
        sealed=AESGCM(key).encrypt(nonce,data,ref.encode());raw=b'GWB1'+nonce+sealed[-16:]+sealed[:-16]
        self.assertEqual(module.verify_envelope(ref,raw,key),len(data))
        with self.assertRaises(Exception):module.verify_envelope('b'*64+ref[64:],raw,key)
        with self.assertRaises(ValueError):module.checked_reference('../bill.enc')
    def test_immutable_nas_copy_and_metadata_have_no_bill_payload(self):
        with tempfile.TemporaryDirectory() as root:
            p=Path(root)/'object';module.write_immutable(p,b'GWB1 encrypted');module.write_immutable(p,b'GWB1 encrypted')
            with self.assertRaises(ValueError):module.write_immutable(p,b'different')
        ref='a'*64+'-'+'b'*64;d={'objectId':'obj_bill_'+hashlib.sha256(ref.encode()).hexdigest(),'version':1,'sha256':'c'*64,'bytes':40}
        sql=module.metadata_sql([{'referenceId':ref,'descriptor':d}],'nas-test-agent')
        self.assertNotIn('bytea',sql);self.assertNotIn('GWB1',sql)
        with self.assertRaises(ValueError):module.metadata_sql([{'referenceId':'bad','descriptor':d}],'nas-test-agent')
if __name__=='__main__':unittest.main()
