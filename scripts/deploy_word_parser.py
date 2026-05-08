import paramiko, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('39.106.172.132', username='root', password='***REMOVED_CREDENTIAL***', timeout=15)

sftp = ssh.open_sftp()

remote_base = '/root/education-platform/modules/question-bank'

# Create directories
for d in ['parsers', 'uploads']:
    try:
        sftp.stat(f'{remote_base}/{d}')
    except:
        sftp.mkdir(f'{remote_base}/{d}')
        print(f'Created {remote_base}/{d}')

# Upload Python parser
sftp.put(r'C:\Users\83423\.openclaw\workspace\scheduling-system\modules\question-bank\parsers\parse_word.py',
         f'{remote_base}/parsers/parse_word.py')

# Upload updated index.js
sftp.put(r'C:\Users\83423\.openclaw\workspace\scheduling-system\modules\question-bank\src\index.js',
         f'{remote_base}/src/index.js')

# Upload parse_word route
sftp.put(r'C:\Users\83423\.openclaw\workspace\scheduling-system\modules\question-bank\src\routes\parse_word.js',
         f'{remote_base}/src/routes/parse_word.js')

sftp.close()

# Install multer if needed
stdin, stdout, stderr = ssh.exec_command("cd /root/education-platform && npm install multer 2>&1 | tail -3")
print('Installing multer:', stdout.read().decode()[:200])

# Install python-docx on server
stdin, stdout, stderr = ssh.exec_command("pip3 install python-docx 2>&1 | tail -3")
print('Installing python-docx:', stdout.read().decode()[:200])

# Restart gateway
stdin, stdout, stderr = ssh.exec_command("pm2 restart edu-gateway 2>&1")
print('Restart:', stdout.read().decode('utf-8', errors='replace')[:200])

# Verify
stdin, stdout, stderr = ssh.exec_command("grep -i 'parse-word\\|question-bank' /root/.pm2/logs/edu-gateway-out.log | tail -5")
print('Logs:', stdout.read().decode('utf-8', errors='replace')[:300])

ssh.close()
print('Word parser deployed!')
