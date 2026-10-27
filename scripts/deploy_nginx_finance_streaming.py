"""Keep finance source request and response bodies out of Nginx disk buffers."""
import argparse,contextlib,io,json,re,shlex,sys
from datetime import datetime,timezone
from pathlib import Path

LIVE_PATH='/etc/nginx/sites-enabled/education-platform'
ENDPOINTS=('api/business/personal-finance/','api/business/miniapp-personal-finance/','api/storage-agent/finance-archives/')
DIRECTIVES=('client_max_body_size 30m;','client_body_buffer_size 32m;','client_body_in_file_only off;','proxy_http_version 1.1;','proxy_request_buffering off;','proxy_buffering off;','proxy_max_temp_file_size 0;')
def patch_nginx_config(source):
    pattern=re.compile(r'(?P<indent>^[ \t]*)location\s+/cloud-business/\s*\{(?P<body>[\s\S]*?\n(?P=indent)\})',re.MULTILINE)
    matches=list(pattern.finditer(source))
    if not matches:raise ValueError('FINANCE_NGINX_LOCATION_MISSING')
    existing=[source.count('location ^~ /cloud-business/'+endpoint+' {') for endpoint in ENDPOINTS]
    if any(existing):
        if all(n==len(matches) for n in existing) and all(source.count(d)>=len(matches)*len(ENDPOINTS) for d in DIRECTIVES):return source
        raise ValueError('FINANCE_NGINX_STREAMING_CONFIG_DRIFT')
    def replace(match):
        indent=match.group('indent');body=match.group('body')
        proxy=re.search(r'proxy_pass\s+(http://(?:127\.0\.0\.1|172\.18\.0\.1):3002/);',body)
        if not proxy:raise ValueError('FINANCE_NGINX_UPSTREAM_UNEXPECTED')
        headers=[line.strip() for line in body.splitlines() if line.strip().startswith('proxy_set_header ')]
        blocks=[]
        for endpoint in ENDPOINTS:
            lines=[indent+'location ^~ /cloud-business/'+endpoint+' {']
            lines.extend(indent+'    '+directive for directive in DIRECTIVES)
            lines.append(indent+'    proxy_pass '+proxy.group(1)+endpoint+';')
            lines.extend(indent+'    '+header for header in headers);lines.append(indent+'}')
            blocks.append('\n'.join(lines))
        return '\n'.join(blocks)+'\n'+match.group(0)
    return pattern.sub(replace,source)
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--evidence-root',required=True);args=parser.parse_args()
    sys.path.insert(0,str(Path(__file__).parent));import deploy
    evidence=Path(args.evidence_root);evidence.mkdir(parents=True,exist_ok=True)
    with contextlib.redirect_stdout(io.StringIO()):ssh=deploy.connect()
    stamp=datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S');backup='/root/scheduling-backups/nginx/finance-streaming-'+stamp+'.conf'
    changed=False;sftp=ssh.open_sftp()
    try:
        with sftp.open(LIVE_PATH,'rb') as stream:original=stream.read()
        updated=patch_nginx_config(original.decode('utf-8')).encode('utf-8')
        (evidence/'nginx-before-finance-streaming.conf').write_bytes(original)
        if updated!=original:
            deploy.run(ssh,'install -d -m 700 /root/scheduling-backups/nginx && cp --preserve=all '+shlex.quote(LIVE_PATH)+' '+shlex.quote(backup))
            with sftp.open(LIVE_PATH,'wb') as stream:stream.write(updated)
            changed=True
        try:
            deploy.run(ssh,'nginx -t && systemctl reload nginx',timeout=30)
            deploy.run(ssh,'curl -fsS --max-time 15 https://physicsedu.xyz/cloud-business/api/health',timeout=25)
        except BaseException:
            if changed:
                with sftp.open(LIVE_PATH,'wb') as stream:stream.write(original)
                deploy.run(ssh,'nginx -t && systemctl reload nginx',timeout=30)
            raise
        with sftp.open(LIVE_PATH,'rb') as stream:
            if stream.read()!=updated:raise ValueError('FINANCE_NGINX_READBACK_FAILED')
        report={'ok':True,'changed':changed,'backup':backup if changed else None,'streamingLocations':len(ENDPOINTS)*len(re.findall(r'location\s+/cloud-business/\s*\{',updated.decode()))}
        (evidence/'nginx-finance-streaming.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
    finally:sftp.close();ssh.close()
if __name__=='__main__':main()
