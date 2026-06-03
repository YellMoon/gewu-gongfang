/**
 * 生成单位库 Word 文档，供人工校对
 * 输出到桌面：格物工坊_单位库_校对文档.docx
 */
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, HeadingLevel, BorderStyle, ShadingType } = require('docx');
const fs = require('fs');
const path = require('path');

// ============================================================================
// 与 QuestionRenderer.tsx 中完全一致的单位定义
// ============================================================================

const SI_PREFIXES = ['Y', 'Z', 'E', 'P', 'T', 'G', 'M', 'k', 'h', 'da', 'd', 'c', 'm', 'μ', 'u', 'n', 'p', 'f', 'a', 'z', 'y'];

const SI_PREFIX_NAMES = {
  'Y': 'yotta (10²⁴)', 'Z': 'zetta (10²¹)', 'E': 'exa (10¹⁸)', 'P': 'peta (10¹⁵)',
  'T': 'tera (10¹²)', 'G': 'giga (10⁹)', 'M': 'mega (10⁶)', 'k': 'kilo (10³)',
  'h': 'hecto (10²)', 'da': 'deca (10¹)', 'd': 'deci (10⁻¹)', 'c': 'centi (10⁻²)',
  'm': 'milli (10⁻³)', 'μ': 'micro (10⁻⁶)', 'u': 'nano (10⁻⁹) [替代n]',
  'n': 'nano (10⁻⁹)', 'p': 'pico (10⁻¹²)', 'f': 'femto (10⁻¹⁵)',
  'a': 'atto (10⁻¹⁸)', 'z': 'zepto (10⁻²¹)', 'y': 'yocto (10⁻²⁴)',
};

const SI_BASE_UNITS = [
  { symbol: 'm', name: '米 (meter)', quantity: '长度' },
  { symbol: 's', name: '秒 (second)', quantity: '时间' },
  { symbol: 'kg', name: '千克 (kilogram)', quantity: '质量' },
  { symbol: 'A', name: '安培 (ampere)', quantity: '电流' },
  { symbol: 'K', name: '开尔文 (kelvin)', quantity: '热力学温度' },
  { symbol: 'mol', name: '摩尔 (mole)', quantity: '物质的量' },
  { symbol: 'cd', name: '坎德拉 (candela)', quantity: '发光强度' },
];

const SI_DERIVED_UNITS = [
  { symbol: 'Hz', name: '赫兹 (hertz)', quantity: '频率', formula: 's⁻¹' },
  { symbol: 'N', name: '牛顿 (newton)', quantity: '力', formula: 'kg·m/s²' },
  { symbol: 'Pa', name: '帕斯卡 (pascal)', quantity: '压强/应力', formula: 'N/m²' },
  { symbol: 'J', name: '焦耳 (joule)', quantity: '能量/功', formula: 'N·m' },
  { symbol: 'W', name: '瓦特 (watt)', quantity: '功率', formula: 'J/s' },
  { symbol: 'C', name: '库仑 (coulomb)', quantity: '电荷量', formula: 'A·s' },
  { symbol: 'V', name: '伏特 (volt)', quantity: '电压/电势', formula: 'W/A' },
  { symbol: 'F', name: '法拉 (farad)', quantity: '电容', formula: 'C/V' },
  { symbol: 'Ω', name: '欧姆 (ohm)', quantity: '电阻', formula: 'V/A' },
  { symbol: 'S', name: '西门子 (siemens)', quantity: '电导', formula: 'A/V' },
  { symbol: 'H', name: '亨利 (henry)', quantity: '电感', formula: 'Wb/A' },
  { symbol: 'T', name: '特斯拉 (tesla)', quantity: '磁感应强度', formula: 'Wb/m²' },
  { symbol: 'Wb', name: '韦伯 (weber)', quantity: '磁通量', formula: 'V·s' },
  { symbol: 'lm', name: '流明 (lumen)', quantity: '光通量', formula: 'cd·sr' },
  { symbol: 'lx', name: '勒克斯 (lux)', quantity: '照度', formula: 'lm/m²' },
  { symbol: 'Bq', name: '贝可勒尔 (becquerel)', quantity: '放射性活度', formula: 's⁻¹' },
  { symbol: 'Gy', name: '戈瑞 (gray)', quantity: '吸收剂量', formula: 'J/kg' },
  { symbol: 'Sv', name: '希沃特 (sievert)', quantity: '等效剂量', formula: 'J/kg' },
  { symbol: 'kat', name: '开特 (katal)', quantity: '催化活性', formula: 'mol/s' },
];

const NON_PREFIXED_UNITS = [
  { symbol: '°', name: '度 (degree)', quantity: '平面角', note: '不可加前缀' },
  { symbol: '°C', name: '摄氏度 (degree Celsius)', quantity: '温度', note: '不可加前缀' },
  { symbol: '°F', name: '华氏度 (degree Fahrenheit)', quantity: '温度', note: '非SI，美英常用' },
  { symbol: '%', name: '百分号 (percent)', quantity: '比例', note: '无量纲' },
  { symbol: '°R', name: '兰金度 (degree Rankine)', quantity: '温度', note: '绝对温标' },
  { symbol: 'eV', name: '电子伏特 (electronvolt)', quantity: '能量', note: '1 eV = 1.602×10⁻¹⁹ J' },
  { symbol: 'keV', name: '千电子伏特', quantity: '能量', note: '' },
  { symbol: 'MeV', name: '兆电子伏特', quantity: '能量', note: '' },
  { symbol: 'GeV', name: '吉电子伏特', quantity: '能量', note: '' },
  { symbol: 'TeV', name: '太电子伏特', quantity: '能量', note: '' },
  { symbol: 'PeV', name: '拍电子伏特', quantity: '能量', note: '' },
  { symbol: 'L', name: '升 (liter)', quantity: '体积', note: '1 L = 10⁻³ m³' },
  { symbol: 'mL', name: '毫升', quantity: '体积', note: '' },
  { symbol: 'μL', name: '微升', quantity: '体积', note: '' },
  { symbol: 'min', name: '分钟 (minute)', quantity: '时间', note: '1 min = 60 s' },
  { symbol: 'h', name: '小时 (hour)', quantity: '时间', note: '1 h = 3600 s' },
  { symbol: 'd', name: '天 (day)', quantity: '时间', note: '1 d = 86400 s' },
  { symbol: 'au', name: '天文单位 (astronomical unit)', quantity: '长度', note: '1 au ≈ 1.496×10¹¹ m' },
  { symbol: 'ly', name: '光年 (light-year)', quantity: '长度', note: '1 ly ≈ 9.461×10¹⁵ m' },
  { symbol: 'u', name: '原子质量单位 (unified atomic mass unit)', quantity: '质量', note: '1 u ≈ 1.661×10⁻²⁷ kg' },
  { symbol: 'Da', name: '道尔顿 (dalton)', quantity: '质量', note: '同 u' },
  { symbol: 'Np', name: '奈培 (neper)', quantity: '对数比', note: '非SI' },
  { symbol: 'B', name: '贝尔 (bel)', quantity: '对数比', note: '1 B = 10 dB' },
  { symbol: 'dB', name: '分贝 (decibel)', quantity: '对数比', note: '1 dB = 0.1 B' },
  { symbol: 'r', name: '转 (revolution)', quantity: '平面角', note: '1 r = 2π rad' },
  { symbol: 'gon', name: '冈 (gradian)', quantity: '平面角', note: '1 gon = 0.9°' },
];

const MATH_FUNCTIONS = [
  { symbol: 'sin', name: '正弦 (sine)' },
  { symbol: 'cos', name: '余弦 (cosine)' },
  { symbol: 'tan', name: '正切 (tangent)' },
  { symbol: 'cot', name: '余切 (cotangent)' },
  { symbol: 'sec', name: '正割 (secant)' },
  { symbol: 'csc', name: '余割 (cosecant)' },
  { symbol: 'arcsin', name: '反正弦 (arcsine)' },
  { symbol: 'arccos', name: '反余弦 (arccosine)' },
  { symbol: 'arctan', name: '反正切 (arctangent)' },
  { symbol: 'arccot', name: '反余切 (arccotangent)' },
  { symbol: 'arcsec', name: '反正割 (arcsecant)' },
  { symbol: 'arccsc', name: '反余割 (arccosecant)' },
  { symbol: 'sinh', name: '双曲正弦 (hyperbolic sine)' },
  { symbol: 'cosh', name: '双曲余弦 (hyperbolic cosine)' },
  { symbol: 'tanh', name: '双曲正切 (hyperbolic tangent)' },
  { symbol: 'coth', name: '双曲余切 (hyperbolic cotangent)' },
  { symbol: 'arsinh', name: '反双曲正弦' },
  { symbol: 'arcosh', name: '反双曲余弦' },
  { symbol: 'artanh', name: '反双曲正切' },
  { symbol: 'arcoth', name: '反双曲余切' },
  { symbol: 'log', name: '常用对数 ( logarithm)' },
  { symbol: 'ln', name: '自然对数 (natural logarithm)' },
  { symbol: 'lg', name: '以10为底对数' },
  { symbol: 'exp', name: '指数函数 (exponential)' },
  { symbol: 'max', name: '最大值 (maximum)' },
  { symbol: 'min', name: '最小值 (minimum)' },
  { symbol: 'sup', name: '上确界 (supremum)' },
  { symbol: 'inf', name: '下确界 (infimum)' },
  { symbol: 'lim', name: '极限 (limit)' },
  { symbol: 'det', name: '行列式 (determinant)' },
  { symbol: 'dim', name: '维数 (dimension)' },
  { symbol: 'gcd', name: '最大公约数' },
  { symbol: 'ker', name: '核 (kernel)' },
  { symbol: 'hom', name: '同态 (homomorphism)' },
];

const DESCRIPTIVE_ABBREVS = [
  { symbol: 'avg', name: '平均值 (average)' },
  { symbol: 'rms', name: '均方根 (root mean square)' },
  { symbol: 'eff', name: '效率 (efficiency)' },
  { symbol: 'tot', name: '总计 (total)' },
  { symbol: 'ext', name: '外部 (external)' },
  { symbol: 'int', name: '内部 (internal)' },
  { symbol: 'rev', name: '转数 (revolution)' },
  { symbol: 'abs', name: '绝对 (absolute)' },
  { symbol: 'rel', name: '相对 (relative)' },
  { symbol: 'sat', name: '饱和 (saturation)' },
  { symbol: 'std', name: '标准 (standard)' },
  { symbol: 'STP', name: '标准温压 (standard temperature and pressure)' },
  { symbol: 'NTP', name: '常温常压 (normal temperature and pressure)' },
  { symbol: 'eq', name: '等式 (equation)' },
  { symbol: 'fig', name: '图 (figure)' },
  { symbol: 'ref', name: '参考 (reference)' },
  { symbol: 'ch', name: '章节 (chapter)' },
  { symbol: 'sec', name: '节 (section)' },
  { symbol: 'vol', name: '卷 (volume)' },
  { symbol: 'ed', name: '版 (edition)' },
];

// ---- 常用组合单位（与 QuestionRenderer.tsx 一致）----
const COMPOUND_UNITS = [
  // === 力学 ===
  { symbol: 'N·m', name: '牛·米', quantity: '力矩/功', note: '同 J' },
  { symbol: 'N·s', name: '牛·秒', quantity: '冲量/动量', note: '' },
  { symbol: 'N/m', name: '牛/米', quantity: '表面张力/弹簧常数', note: '' },
  { symbol: 'kg·m/s²', name: '千克·米/秒²', quantity: '力', note: '同 N' },
  { symbol: 'kg·m²/s²', name: '千克·米²/秒²', quantity: '能量', note: '同 J' },
  { symbol: 'kg·m²', name: '千克·米²', quantity: '转动惯量', note: '' },
  { symbol: 'kg/m³', name: '千克/米³', quantity: '密度', note: '' },
  { symbol: 'kg/m²', name: '千克/米²', quantity: '面密度', note: '' },
  { symbol: 'kg/(m·s²)', name: '千克/(米·秒²)', quantity: '压强', note: '同 Pa' },
  { symbol: 'm/s', name: '米/秒', quantity: '速度', note: '最常用组合之一' },
  { symbol: 'm/s²', name: '米/秒²', quantity: '加速度', note: '' },
  { symbol: 'm²/s', name: '米²/秒', quantity: '运动粘度', note: '' },
  { symbol: 'm³/s', name: '米³/秒', quantity: '体积流量', note: '' },
  { symbol: 'm²/s²', name: '米²/秒²', quantity: '比能', note: '' },
  { symbol: 'm³/s²', name: '米³/秒²', quantity: '', note: '' },
  { symbol: 'm⁴/s', name: '米⁴/秒', quantity: '', note: '' },
  { symbol: 'Pa·s', name: '帕·秒', quantity: '动力粘度', note: '' },
  { symbol: 'Pa·m', name: '帕·米', quantity: '表面张力', note: '同 N/m' },
  { symbol: 'Pa/m', name: '帕/米', quantity: '压强梯度', note: '' },
  { symbol: 'Pa·m²', name: '帕·米²', quantity: '', note: '' },
  // === 电磁学 ===
  { symbol: 'V·s', name: '伏·秒', quantity: '磁通量', note: '同 Wb' },
  { symbol: 'V/m', name: '伏/米', quantity: '电场强度', note: '' },
  { symbol: 'V²', name: '伏²', quantity: '', note: '' },
  { symbol: 'A·s', name: '安·秒', quantity: '电荷量', note: '同 C' },
  { symbol: 'A·m', name: '安·米', quantity: '磁偶极矩', note: '' },
  { symbol: 'A/m', name: '安/米', quantity: '磁场强度', note: '' },
  { symbol: 'A/m²', name: '安/米²', quantity: '电流密度', note: '' },
  { symbol: 'A·m²', name: '安·米²', quantity: '磁矩', note: '' },
  { symbol: 'C·m', name: '库·米', quantity: '电偶极矩', note: '' },
  { symbol: 'C/m', name: '库/米', quantity: '线电荷密度', note: '' },
  { symbol: 'C/m²', name: '库/米²', quantity: '电位移/面电荷密度', note: '' },
  { symbol: 'C/m³', name: '库/米³', quantity: '体电荷密度', note: '' },
  { symbol: 'C²', name: '库²', quantity: '', note: '' },
  { symbol: 'F/m', name: '法/米', quantity: '真空介电常数', note: 'ε₀ ≈ 8.85×10⁻¹² F/m' },
  { symbol: 'F·m', name: '法·米', quantity: '', note: '' },
  { symbol: 'H/m', name: '亨/米', quantity: '真空磁导率', note: 'μ₀ = 4π×10⁻⁷ H/m' },
  { symbol: 'H·m', name: '亨·米', quantity: '', note: '' },
  { symbol: 'Ω·m', name: '欧·米', quantity: '电阻率', note: '' },
  { symbol: 'Ω/m', name: '欧/米', quantity: '', note: '' },
  { symbol: 'Ω·m²', name: '欧·米²', quantity: '', note: '' },
  { symbol: 'S/m', name: '西/米', quantity: '电导率', note: '' },
  { symbol: 'S·m', name: '西·米', quantity: '', note: '' },
  { symbol: 'Wb/m', name: '韦/米', quantity: '磁化强度', note: '' },
  { symbol: 'Wb·m', name: '韦·米', quantity: '', note: '' },
  { symbol: 'T·m', name: '特·米', quantity: '磁通势', note: '' },
  { symbol: 'T·m²', name: '特·米²', quantity: '磁矩', note: '' },
  { symbol: 'T/m', name: '特/米', quantity: '磁场梯度', note: '' },
  { symbol: 'J·m', name: '焦·米', quantity: '', note: '' },
  { symbol: 'J/m³', name: '焦/米³', quantity: '能量密度', note: '' },
  { symbol: 'J/m²', name: '焦/米²', quantity: '能量面密度', note: '' },
  { symbol: 'J·m²', name: '焦·米²', quantity: '', note: '' },
  { symbol: 'W·m', name: '瓦·米', quantity: '', note: '' },
  { symbol: 'W/m²', name: '瓦/米²', quantity: '辐照度', note: '' },
  { symbol: 'W/m³', name: '瓦/米³', quantity: '功率密度', note: '' },
  // === 热学 ===
  { symbol: 'W/(m·K)', name: '瓦/(米·开)', quantity: '热导率', note: '' },
  { symbol: 'J/(kg·K)', name: '焦/(千克·开)', quantity: '比热容/比熵', note: '' },
  { symbol: 'J/(kg·m²)', name: '焦/(千克·米²)', quantity: '', note: '' },
  { symbol: 'K/m', name: '开/米', quantity: '温度梯度', note: '' },
  { symbol: 'K·m²/W', name: '开·米²/瓦', quantity: '热阻', note: '' },
  { symbol: 'J/K', name: '焦/开', quantity: '热容', note: '' },
  { symbol: 'J/(mol·K)', name: '焦/(摩·开)', quantity: '摩尔熵', note: '' },
  { symbol: 'J/mol', name: '焦/摩', quantity: '摩尔能量', note: '' },
  { symbol: 'Pa/K', name: '帕/开', quantity: '', note: '' },
  { symbol: 'm²/(V·s)', name: '米²/(伏·秒)', quantity: '载流子迁移率', note: '' },
  // === 光学 ===
  { symbol: 'cd/m²', name: '坎/米²', quantity: '亮度', note: '' },
  { symbol: 'lm·s', name: '流·秒', quantity: '光量', note: '' },
  { symbol: 'lx·s', name: '勒·秒', quantity: '曝光量', note: '' },
  { symbol: 'lx/m', name: '勒/米', quantity: '', note: '' },
  { symbol: 'cd·sr', name: '坎·球面度', quantity: '光通量', note: '同 lm' },
  // === 流体力学 ===
  { symbol: 'Pa·s/m', name: '帕·秒/米', quantity: '', note: '' },
  { symbol: 'm²/s³', name: '米²/秒³', quantity: '', note: '' },
  // === 原子/核物理 ===
  { symbol: 'kg/mol', name: '千克/摩', quantity: '摩尔质量', note: '' },
  { symbol: 'eV/atom', name: '电子伏/原子', quantity: '原子能量', note: '' },
  { symbol: 'eV·m', name: '电子伏·米', quantity: '', note: '' },
  { symbol: 'J·s', name: '焦·秒', quantity: '作用量', note: '同 h/2π' },
  // === 通用导出 ===
  { symbol: 'kg·m', name: '千克·米', quantity: '', note: '' },
  { symbol: 'kg/s', name: '千克/秒', quantity: '质量流量', note: '' },
  { symbol: 'kg/s²', name: '千克/秒²', quantity: '', note: '' },
  { symbol: 'kg·m/s', name: '千克·米/秒', quantity: '动量', note: '同 N·s' },
  { symbol: 'm·K', name: '米·开', quantity: '', note: '' },
  { symbol: 'mol/m³', name: '摩/米³', quantity: '物质的量浓度', note: '' },
  { symbol: 'mol/(m²·s)', name: '摩/(米²·秒)', quantity: '', note: '' },
];

// 含 "/" 但不在单位库中的常见电场/磁场组合单位（通过上下文启发式判断）
const SLASH_COMPOUND_UNITS = [
  { symbol: 'V/m', name: '伏/米', quantity: '电场强度', note: '最常用形式；等价于 N/C' },
  { symbol: 'N/C', name: '牛/库', quantity: '电场强度', note: '等价于 V/m' },
  { symbol: 'N/A', name: '牛/安', quantity: '磁力常数', note: '' },
  { symbol: 'J/C', name: '焦/库', quantity: '电压', note: '同 V' },
  { symbol: 'W/A', name: '瓦/安', quantity: '电压', note: '同 V' },
  { symbol: 'C/V', name: '库/伏', quantity: '电容', note: '同 F' },
  { symbol: 'V/A', name: '伏/安', quantity: '电阻', note: '同 Ω' },
  { symbol: 'A/V', name: '安/伏', quantity: '电导', note: '同 S' },
  { symbol: 'Wb/A', name: '韦/安', quantity: '电感', note: '同 H' },
  { symbol: 'J/kg', name: '焦/千克', quantity: '比能', note: '' },
  { symbol: 'W/m', name: '瓦/米', quantity: '辐射出射度', note: '' },
  { symbol: 'N/m', name: '牛/米', quantity: '表面张力/弹簧常数', note: '' },
  { symbol: 'J/mol', name: '焦/摩', quantity: '摩尔能量', note: '' },
];

// ============================================================================
// 生成逻辑（与 QuestionRenderer.tsx buildUnitLibrary 一致）
// ============================================================================

function buildUnitLibrary() {
  const units = new Set();
  for (const u of NON_PREFIXED_UNITS) { if (u.symbol.length > 1) units.add(u.symbol); }
  for (const base of SI_BASE_UNITS) {
    if (base.symbol.length > 1) units.add(base.symbol);
    if (base.symbol !== 'kg') {
      for (const p of SI_PREFIXES) units.add(p + base.symbol);
    }
  }
  for (const d of SI_DERIVED_UNITS) {
    if (d.symbol.length > 1) units.add(d.symbol);
    for (const p of SI_PREFIXES) units.add(p + d.symbol);
  }
  // 组合单位（含前缀组合）
  for (const c of COMPOUND_UNITS) {
    units.add(c.symbol);
    for (const p of SI_PREFIXES) units.add(p + c.symbol);
  }
  for (const fn of MATH_FUNCTIONS) units.add(fn.symbol);
  for (const abbr of DESCRIPTIVE_ABBREVS) units.add(abbr.symbol);
  return units;
}

function buildPrefixedUnits() {
  const result = [];
  // SI 基本单位 × 前缀
  for (const base of SI_BASE_UNITS) {
    if (base.symbol === 'kg') continue; // kg 已含前缀
    for (const prefix of SI_PREFIXES) {
      result.push({ prefix, base: base.symbol, combined: prefix + base.symbol, quantity: base.quantity });
    }
  }
  // SI 导出单位 × 前缀
  for (const d of SI_DERIVED_UNITS) {
    for (const prefix of SI_PREFIXES) {
      result.push({ prefix, base: d.symbol, combined: prefix + d.symbol, quantity: d.quantity });
    }
  }
  return result;
}

// ============================================================================
// Word 文档生成
// ============================================================================

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };
const HEADER_SHADING = { type: ShadingType.SOLID, color: '2B579A' };
const ALT_SHADING = { type: ShadingType.SOLID, color: 'F2F2F2' };

function headerCell(text, width) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    shading: HEADER_SHADING,
    borders: NO_BORDERS,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: 'FFFFFF', font: '微软雅黑', size: 20 })] })],
  });
}

function cell(text, width, shading) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    shading: shading || undefined,
    borders: NO_BORDERS,
    children: [new Paragraph({ children: [new TextRun({ text, font: 'Consolas', size: 20 })] })],
  });
}

function cellNormal(text, width, shading) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    shading: shading || undefined,
    borders: NO_BORDERS,
    children: [new Paragraph({ children: [new TextRun({ text, font: '微软雅黑', size: 20 })] })],
  });
}

function sectionTitle(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 100 },
    children: [new TextRun({ text, font: '微软雅黑', size: 28, bold: true, color: '2B579A' })],
  });
}

function infoPara(text) {
  return new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text, font: '微软雅黑', size: 20, color: '666666' })],
  });
}

async function main() {
  const library = buildUnitLibrary();
  const prefixed = buildPrefixedUnits();

  const children = [];

  // ---- 封面 ----
  children.push(new Paragraph({ spacing: { before: 2000 } }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: '格物工坊 — 正斜体单位库', font: '微软雅黑', size: 48, bold: true, color: '2B579A' })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new TextRun({ text: '校对文档 v1.0', font: '微软雅黑', size: 28, color: '666666' })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `单位库总计 ${library.size} 个条目`, font: '微软雅黑', size: 24 })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: '2026-06-02', font: '微软雅黑', size: 22, color: '999999' })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
    children: [new TextRun({ text: '说明：单字母 SI 单位（m, s, T, V, N 等）不收录进单位库，', font: '微软雅黑', size: 22, color: 'CC0000' })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: '因为它们既可能是单位也可能是物理量，需要通过上下文判断。', font: '微软雅黑', size: 22, color: 'CC0000' })],
  }));

  // ---- 分页 ----
  children.push(new Paragraph({ pageBreakBefore: true }));

  // ---- 1. SI 前缀表 ----
  children.push(sectionTitle('一、SI 国际单位制前缀'));
  children.push(infoPara(`共 ${SI_PREFIXES.length} 个前缀，从小到大排列。前缀与基本单位组合后形成完整单位。`));

  const prefixRows = [];
  prefixRows.push(new TableRow({ children: [headerCell('符号', 15), headerCell('名称', 25), headerCell('数量级', 30), headerCell('在库中', 30)] }));
  for (const p of SI_PREFIXES) {
    const name = SI_PREFIX_NAMES[p] || '';
    prefixRows.push(new TableRow({ children: [
      cell(p, 15), cellNormal(name, 25), cellNormal('', 30), cellNormal('作为组合的一部分', 30),
    ] }));
  }
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: prefixRows }));
  children.push(new Paragraph({ spacing: { after: 200 } }));

  // ---- 2. SI 基本单位 ----
  children.push(sectionTitle('二、SI 基本单位（7个）'));
  children.push(infoPara('kg, mol, cd 为多字母，直接收录进单位库。m, s, A, K 为单字母，不收录（需上下文判断）。'));

  const baseRows = [];
  baseRows.push(new TableRow({ children: [headerCell('符号', 12), headerCell('名称', 25), headerCell('物理量', 20), headerCell('加前缀', 20), headerCell('备注', 23)] }));
  for (const u of SI_BASE_UNITS) {
    const canPrefix = u.symbol !== 'kg';
    baseRows.push(new TableRow({ children: [
      cell(u.symbol, 12), cellNormal(u.name, 25), cellNormal(u.quantity, 20),
      cellNormal(canPrefix ? '是（除kg外）' : '否（已含k）', 20),
      cellNormal(u.symbol.length > 1 ? '✓ 已收录' : '✗ 单字母不收录', 23),
    ] }));
  }
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: baseRows }));
  children.push(new Paragraph({ spacing: { after: 200 } }));

  // ---- 3. SI 导出单位 ----
  children.push(sectionTitle('三、SI 导出单位（19个）'));
  children.push(infoPara('多字母导出单位（Hz, Pa, Wb, lm, lx, Bq, Gy, Sv, kat）直接收录。单字母导出单位（N, V, F, T 等）不收录。'));

  const derivedRows = [];
  derivedRows.push(new TableRow({ children: [headerCell('符号', 10), headerCell('名称', 22), headerCell('物理量', 18), headerCell('定义式', 20), headerCell('收录情况', 30)] }));
  for (const u of SI_DERIVED_UNITS) {
    derivedRows.push(new TableRow({ children: [
      cell(u.symbol, 10), cellNormal(u.name, 22), cellNormal(u.quantity, 18),
      cellNormal(u.formula || '', 20),
      cellNormal(u.symbol.length > 1 ? `✓ ${u.symbol} + 所有前缀${u.symbol}` : `✗ ${u.symbol} 单字母不收录，前缀${u.symbol} 已收录`, 30),
    ] }));
  }
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: derivedRows }));
  children.push(new Paragraph({ spacing: { after: 200 } }));

  // ---- 4. 不可加前缀的单位 ----
  children.push(sectionTitle('四、不可加前缀的单位'));
  children.push(infoPara('这些单位有固定含义，不能加 SI 前缀（除 eV 系列外）。'));

  const nonPrefixRows = [];
  nonPrefixRows.push(new TableRow({ children: [headerCell('符号', 15), headerCell('名称', 35), headerCell('物理量', 20), headerCell('备注', 30)] }));
  for (const u of NON_PREFIXED_UNITS) {
    nonPrefixRows.push(new TableRow({ children: [
      cell(u.symbol, 15), cellNormal(u.name, 35), cellNormal(u.quantity, 20), cellNormal(u.note || '', 30),
    ] }));
  }
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: nonPrefixRows }));
  children.push(new Paragraph({ spacing: { after: 200 } }));

  // ---- 5. 数学函数 ----
  children.push(sectionTitle('五、数学函数（永远正体）'));
  children.push(infoPara('ISO 80000-2 规定数学函数名使用正体。'));

  const funcRows = [];
  funcRows.push(new TableRow({ children: [headerCell('符号', 20), headerCell('名称', 40), headerCell('收录', 40)] }));
  for (const f of MATH_FUNCTIONS) {
    funcRows.push(new TableRow({ children: [
      cell(f.symbol, 20), cellNormal(f.name, 40), cellNormal('✓ UNIT_LIBRARY', 40),
    ] }));
  }
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: funcRows }));
  children.push(new Paragraph({ spacing: { after: 200 } }));

  // ---- 6. 描述性缩写 ----
  children.push(sectionTitle('六、描述性缩写（永远正体）'));
  children.push(infoPara('这些缩写用于下标或正文，不是物理量符号。'));

  const abbrRows = [];
  abbrRows.push(new TableRow({ children: [headerCell('符号', 20), headerCell('名称', 40), headerCell('收录', 40)] }));
  for (const a of DESCRIPTIVE_ABBREVS) {
    abbrRows.push(new TableRow({ children: [
      cell(a.symbol, 20), cellNormal(a.name, 40), cellNormal('✓ UNIT_LIBRARY', 40),
    ] }));
  }
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: abbrRows }));
  children.push(new Paragraph({ spacing: { after: 200 } }));

  // ---- 7. 组合单位（dot 连接，可作为单 token）----
  children.push(sectionTitle('七、组合单位（dot/分数连接）'));
  children.push(infoPara('这些组合单位在 HTML 中可能作为单个 token 出现（如 Pa·s），收录进 UNIT_LIBRARY。'));

  const compoundRows = [];
  compoundRows.push(new TableRow({ children: [headerCell('符号', 20), headerCell('名称', 25), headerCell('物理量', 20), headerCell('备注', 35)] }));
  for (const u of COMPOUND_UNITS) {
    compoundRows.push(new TableRow({ children: [
      cell(u.symbol, 20), cellNormal(u.name, 25), cellNormal(u.quantity, 20), cellNormal(u.note || '', 35),
    ] }));
  }
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: compoundRows }));
  children.push(new Paragraph({ spacing: { after: 200 } }));

  // ---- 8. 斜杠组合单位（含 "/"，不作为单 token，需上下文判断）----
  children.push(new Paragraph({ pageBreakBefore: true }));
  children.push(sectionTitle('八、斜杠组合单位（含 "/"，需上下文判断）'));
  children.push(infoPara('这些单位含 "/"，在 HTML 中会被拆分为多个 token（如 V/m → V, /, m），不收录进 UNIT_LIBRARY。'));
  children.push(infoPara('判断规则：斜杠前方的 token（如 V）→ 下方是 "/" → 上下文判定为正体；斜杠后方的 token（如 m）→ prevEndsWithUnitFraction → 正体。'));

  const slashRows = [];
  slashRows.push(new TableRow({ children: [headerCell('符号', 18), headerCell('名称', 25), headerCell('物理量', 22), headerCell('备注', 35)] }));
  for (const u of SLASH_COMPOUND_UNITS) {
    slashRows.push(new TableRow({ children: [
      cell(u.symbol, 18), cellNormal(u.name, 25), cellNormal(u.quantity, 22), cellNormal(u.note || '', 35),
    ] }));
  }
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: slashRows }));
  children.push(new Paragraph({ spacing: { after: 200 } }));

  // ---- 分页：前缀组合完整列表 ----
  children.push(new Paragraph({ pageBreakBefore: true }));
  children.push(sectionTitle('九、前缀 × 单位 组合完整列表'));
  children.push(infoPara(`共 ${prefixed.length} 个组合。这些组合全部收录进 UNIT_LIBRARY，匹配到即强制正体。`));

  // 按基本单位分组
  const grouped = {};
  for (const item of prefixed) {
    const key = item.base;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }

  for (const [base, items] of Object.entries(grouped)) {
    const baseInfo = [...SI_BASE_UNITS, ...SI_DERIVED_UNITS].find(u => u.symbol === base);
    children.push(new Paragraph({
      spacing: { before: 200, after: 100 },
      children: [new TextRun({ text: `${base} — ${baseInfo ? baseInfo.name : base}`, font: '微软雅黑', size: 22, bold: true })],
    }));

    const rows = [];
    rows.push(new TableRow({ children: [headerCell('组合', 25), headerCell('前缀', 25), headerCell('物理量', 25), headerCell('在库中', 25)] }));
    for (const item of items) {
      rows.push(new TableRow({ children: [
        cell(item.combined, 25), cellNormal(item.prefix, 25), cellNormal(item.quantity, 25), cellNormal('✓', 25),
      ] }));
    }
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
    children.push(new Paragraph({ spacing: { after: 100 } }));
  }

  // ---- 分页：单字母单位说明 ----
  children.push(new Paragraph({ pageBreakBefore: true }));
  children.push(sectionTitle('十、单字母单位说明（不收录，需上下文判断）'));
  children.push(infoPara('以下单字母在物理语境中既可能是单位也可能是物理量，因此不收录进单位库，改用上下文启发式判断。'));

  const singleLetterInfo = [
    { symbol: 'm', asUnit: '米 (meter) — 长度单位', asVar: '质量 (mass) — 物理量', context: '5m/s → 单位; F=ma → 变量' },
    { symbol: 's', asUnit: '秒 (second) — 时间单位', asVar: '位移 (displacement) — 物理量', context: 'm/s → 单位; s=vt → 变量' },
    { symbol: 'A', asUnit: '安培 (ampere) — 电流单位', asVar: '面积 (area) — 物理量', context: '10A → 单位; A=πr² → 变量' },
    { symbol: 'K', asUnit: '开尔文 (kelvin) — 温度单位', asVar: 'Kerr常数 — 物理量', context: '300K → 单位; K=... → 变量' },
    { symbol: 'N', asUnit: '牛顿 (newton) — 力单位', asVar: '粒子数 — 物理量', context: '10N → 单位; N=... → 变量' },
    { symbol: 'V', asUnit: '伏特 (volt) — 电压单位', asVar: '速度/体积 — 物理量', context: '220V → 单位; V=IR → 变量' },
    { symbol: 'T', asUnit: '特斯拉 (tesla) — 磁场单位', asVar: '温度/周期 — 物理量', context: '0.5T → 单位; T=2π/ω → 变量' },
    { symbol: 'F', asUnit: '法拉 (farad) — 电容单位', asVar: '力 (force) — 物理量', context: '100μF → 单位; F=ma → 变量' },
    { symbol: 'C', asUnit: '库仑 (coulomb) — 电荷单位', asVar: '电容/比热 — 物理量', context: '5C → 单位; C=Q/U → 变量' },
    { symbol: 'H', asUnit: '亨利 (henry) — 电感单位', asVar: '高度/哈密顿量 — 物理量', context: '10mH → 单位; H=... → 变量' },
    { symbol: 'W', asUnit: '瓦特 (watt) — 功率单位', asVar: '功/宽度 — 物理量', context: '100W → 单位; W=Fs → 变量' },
    { symbol: 'J', asUnit: '焦耳 (joule) — 能量单位', asVar: '转动惯量 — 物理量', context: '50J → 单位; J=... → 变量' },
    { symbol: 'S', asUnit: '西门子 (siemens) — 电导单位', asVar: '熵/面积 — 物理量', context: '5S → 单位; S=... → 变量' },
    { symbol: 'Ω', asUnit: '欧姆 (ohm) — 电阻单位', asVar: '立体角 — 物理量', context: '100Ω → 单位; Ω=... → 变量' },
  ];

  const slRows = [];
  slRows.push(new TableRow({ children: [headerCell('符号', 10), headerCell('作为单位', 30), headerCell('作为物理量', 30), headerCell('上下文判断', 30)] }));
  for (const item of singleLetterInfo) {
    slRows.push(new TableRow({ children: [
      cell(item.symbol, 10), cellNormal(item.asUnit, 30), cellNormal(item.asVar, 30), cellNormal(item.context, 30),
    ] }));
  }
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: slRows }));

  // ---- 生成文档 ----
  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  const buffer = await Packer.toBuffer(doc);
  const desktop = path.join(require('os').homedir(), 'Desktop');
  const outPath = path.join(desktop, '格物工坊_单位库_校对文档.docx');
  fs.writeFileSync(outPath, buffer);
  console.log(`已生成: ${outPath}`);
  console.log(`单位库总计: ${library.size} 个条目`);
  console.log(`前缀组合: ${prefixed.length} 个`);
}

main().catch(err => { console.error(err); process.exit(1); });
