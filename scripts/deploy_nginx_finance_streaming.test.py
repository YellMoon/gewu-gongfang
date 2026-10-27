import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('nginx',Path(__file__).with_name('deploy_nginx_finance_streaming.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class FinanceStreamingTests(unittest.TestCase):
    def test_precise_locations_preserve_api_paths_and_existing_routes(self):
        source=(Path(__file__).parent/'nginx-scheduling.conf').read_text(encoding='utf-8');patched=module.patch_nginx_config(source)
        self.assertEqual(module.patch_nginx_config(patched),patched)
        for directive in module.DIRECTIVES:self.assertEqual(patched.count(directive)-source.count(directive),3)
        for endpoint in module.ENDPOINTS:self.assertIn('proxy_pass http://172.18.0.1:3002/'+endpoint+';',patched)
        self.assertIn('proxy_pass http://backend:8000/api/;',patched)
        self.assertEqual(patched.count('location /cloud-business/ {'),1)
    def test_both_http_and_https_and_unknown_upstream_fail_closed(self):
        block='server {\n    location /cloud-business/ {\n        proxy_pass http://127.0.0.1:3002/;\n    }\n}\n'
        patched=module.patch_nginx_config(block+block);self.assertEqual(patched.count('proxy_request_buffering off;'),6)
        with self.assertRaises(ValueError):module.patch_nginx_config(block.replace('127.0.0.1','evil.example'))
        with self.assertRaises(ValueError):module.patch_nginx_config('server {}')
if __name__=='__main__':unittest.main()
