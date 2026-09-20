'use strict';

// Question-layout assertions exclude only the supplied title paragraph, whose
// original 1pt drawing is separately byte/relationship-tested as template art.
// Do not exclude question media or native formulas from content regressions.
async function questionXml(archive) {
  const xml = await archive.file('word/document.xml').async('string');
  return xml.replace(/(<w:body>)<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/, '$1');
}
module.exports = { questionXml };
