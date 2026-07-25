const assert = require('assert');
const { latexToEqField, latexToMathml, renderLatexSvg, resolveFormulaMode } = require('./formulaExportService');

assert.ok(latexToMathml('\\frac{a}{b}').includes('<mfrac>'));
assert.ok(renderLatexSvg('\\sqrt{x}').svg.includes('<svg'));
assert.match(latexToEqField('\\frac{a}{b}'), /\\f\(a,b\)/);
assert.match(latexToEqField('\\sqrt{x}'), /\\r\(,x\)/);
assert.match(latexToEqField('f(x)=\\begin{cases}x,&x\\ge0\\\\-x,&x<0\\end{cases}'), /\\b\\lc\\\{/);
assert.match(latexToEqField('\\int_0^t v\\,dt'), /\\i\\su\(0,t,v dt\)/);
assert.strictEqual(resolveFormulaMode('mathtype'), 'mathtype-compatible');
assert.strictEqual(resolveFormulaMode('unknown'), 'word-native');
console.log('formulaExportService tests passed');
