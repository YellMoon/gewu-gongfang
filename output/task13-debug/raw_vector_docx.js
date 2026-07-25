const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { Document, ImageRun, Packer, Paragraph } = require('docx');
const { renderLatexSvg } = require('../../backend/src/services/formulaExportService');

(async () => {
  const formulas = ['\\frac{v_0^2}{2g}', '\\sqrt{a^2+b^2}', '\\alpha+\\beta', '\\int_0^t v\\,dt', 'f(x)=\\begin{cases}x^2,&x\\ge0\\\\-x,&x<0\\end{cases}', 'f(2)=4'];
  const children = [];
  for (const latex of formulas) {
    const formula = renderLatexSvg(latex);
    const svg = Buffer.from(formula.svg);
    const png = await sharp(svg).png().toBuffer();
    children.push(new Paragraph({ children: [new ImageRun({
      type: 'svg', data: svg, fallback: { type: 'png', data: png },
      transformation: { width: formula.width, height: formula.height },
      altText: { title: 'formula', description: 'formula', name: 'formula' },
    })] }));
  }
  const document = new Document({ sections: [{ children }] });
  const target = path.join(__dirname, 'raw-vector.docx');
  fs.writeFileSync(target, await Packer.toBuffer(document));
  process.stdout.write(`${target}\n`);
})().catch(error => { console.error(error); process.exit(1); });
