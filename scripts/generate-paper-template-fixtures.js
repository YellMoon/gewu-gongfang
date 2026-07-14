const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { writePaperArtifact } = require('../backend/src/services/paperArtifactService');

const root = path.join(process.cwd(), 'tmp', 'paper-template-fixtures', 'store');
const output = path.join(process.cwd(), 'tmp', 'paper-template-fixtures');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const questions = [
  { id: 'fixture-choice', type: '\u5355\u9009\u9898', stem: '\u901f\u5ea6\u4e0e\u65f6\u95f4\u7684\u590d\u5408\u9898 $v=\\frac{s}{t}$', options: ['2 m/s', '4 m/s'], answer: 'B', explanation: '\u4f7f\u7528\u901f\u5ea6\u5b9a\u4e49\u8ba1\u7b97\u3002', knowledge_points: ['\u901f\u5ea6'], assets: [{ mime_type: 'image/png', oss_url: pixel, width: 80 }] },
  { id: 'fixture-solution', type: '\u89e3\u7b54\u9898', stem: '\u8bf7\u8ba1\u7b97\u673a\u68b0\u80fd\u3002', answer: '42 J', explanation: '\u7531\u673a\u68b0\u80fd\u5b88\u6052\u5f97\u5230\u3002', knowledge_point_names: ['\u673a\u68b0\u80fd\u5b88\u6052'] },
  { id: 'fixture-multiple', type: '\u591a\u9009\u9898', stem: '\u9009\u51fa\u6b63\u786e\u7684\u6ce2\u52a8\u73b0\u8c61\u3002', options: ['A', 'B', 'C'], answer: 'AC', explanation: '\u6839\u636e\u6ce2\u52a8\u89c4\u5f8b\u5224\u65ad\u3002', knowledge_point: '\u6ce2\u52a8' },
];

(async () => {
  const visual = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" rx="8" fill="#dbeafe"/><circle cx="42" cy="40" r="22" fill="#2563eb"/><text x="76" y="47" font-family="Arial" font-size="20" fill="#1e3a8a">IMAGE</text></svg>')).png().toBuffer();
  questions[0].assets[0].oss_url = `data:image/png;base64,${visual.toString('base64')}`;
  questions[0].assets[0].width = 160;
  fs.mkdirSync(output, { recursive: true });
  for (const answerPosition of ['end', 'after-each']) {
    for (const format of ['word', 'pdf']) {
      const artifact = await writePaperArtifact(format, { title: `complex-${answerPosition}`, answerPosition, formulaMode: 'word-native' }, questions, { root });
      const target = path.join(output, `complex-${answerPosition}.${format === 'word' ? 'docx' : 'pdf'}`);
      fs.copyFileSync(artifact.filePath, target);
      console.log(target);
    }
  }
})().catch(error => { console.error(error); process.exit(1); });
