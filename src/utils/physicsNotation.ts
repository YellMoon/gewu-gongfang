/**
 * 物理学科中关于字母、数字的字体与正斜体规范
 *
 * 依据：
 *   ISO 80000-2:2019《量和单位—第2部分：数学》
 *   GB 3102.11-1993《物理科学和技术中使用的数学符号》
 *   IUPAP 红皮书《符号、单位和术语指南》
 *
 * 核心原则：
 *   物理量符号 → 斜体 (italic)
 *   单位符号   → 正体 (upright/roman)
 *   数学常数   → 正体
 *   函数名     → 正体
 *   微分符号 d → 正体
 *   向量/张量  → 粗斜体 (bold italic)
 *
 * 判断逻辑：
 *   字母前有数字 → 单位（正体）  【最高优先级】
 *   字母在单位集合中且前面有数字 → 单位（正体）
 *   字母在物理量集合中 → 物理量（斜体）
 *   选择题选项标签 A-G → 正体
 */

// ============================================================
// 一、SI 词头（prefixes）
// ============================================================

export const SI_PREFIXES: Record<string, number> = {
  'Y': 24,  // yotta
  'Z': 21,  // zetta
  'E': 18,  // exa
  'P': 15,  // peta
  'T': 12,  // tera
  'G': 9,   // giga
  'M': 6,   // mega
  'k': 3,   // kilo
  'h': 2,   // hecto
  'da': 1,  // deca
  'd': -1,  // deci
  'c': -2,  // centi
  'm': -3,  // milli (prefix)
  'μ': -6,  // micro
  'n': -9,  // nano
  'p': -12, // pico
  'f': -15, // femto
  'a': -18, // atto
  'z': -21, // zepto
  'y': -24, // yocto
};

export const SI_PREFIX_NAMES: string[] = Object.keys(SI_PREFIXES);

// ============================================================
// 二、所有物理单位（带词头展开）
// ============================================================

/** 基础单位（不含词头） */
const BASE_UNITS: Record<string, string[]> = {
  // 长度 length
  length: ['m', 'AU', 'ly', 'pc', 'Å'],
  // 质量 mass
  mass: ['g', 't', 'u', 'Da', 'lb', 'oz'],
  // 时间 time
  time: ['s', 'min', 'h', 'd', 'yr', 'a'],
  // 温度 temperature
  temperature: ['K', '°C', '°F'],
  // 物质的量
  amount: ['mol'],
  // 发光强度
  luminosity: ['cd', 'lm', 'lx'],
  // 平面角/立体角
  angle: ['rad', 'sr', '°', "'", '"'],
  // 面积 area
  area: ['ha', 'b'],
  // 体积 volume
  volume: ['L'],
};

/** 专门单位（含常用复合单位，不含词头） */
const NAMED_UNITS: Record<string, string[]> = {
  // 力学
  force: ['N', 'dyn'],
  pressure: ['Pa', 'bar', 'atm', 'Torr', 'mmHg', 'psi'],
  energy: ['J', 'cal', 'erg', 'Wh', 'Btu'],
  power: ['W', 'hp'],
  // 电磁学
  electric: ['V', 'A', 'Ω', 'F', 'H', 'S', 'C', 'T', 'Wb', 'G', 'Oe'],
  // 频率
  frequency: ['Hz', 'Bd'],
  // 放射性
  radioactivity: ['Bq', 'Ci'],
  dose: ['Gy', 'Sv', 'rem'],
  // 催化
  catalytic: ['kat'],
  // 电子伏特（特殊：eV 带前缀）
  electronvolt: ['eV'],
  // 信息
  information: ['B', 'bit', 'byte', 'Bq'],
};

/** 不带词头的单位集合 */
const BASE_UNIT_SET: Set<string> = new Set();
for (const arr of Object.values(BASE_UNITS)) {
  for (const u of arr) BASE_UNIT_SET.add(u);
}
for (const arr of Object.values(NAMED_UNITS)) {
  for (const u of arr) BASE_UNIT_SET.add(u);
}

/** 可以加词头的单位（长度、质量、时间、电学等） */
const PREFIXABLE_UNITS = new Set([
  'm', 'g', 's', 'A', 'V', 'Ω', 'F', 'H', 'S', 'C', 'J', 'W', 'N', 'Pa',
  'Hz', 'T', 'Wb', 'Bq', 'Gy', 'Sv', 'lm', 'lx', 'L', 'eV', 'mol', 'cd',
  'kat', 'bar', 'cal', 'b', 'Bd',
]);

/** 特殊组合单位（eV + 词头 = MeV, GeV, TeV） */
const ELECTRONVOLT_PREFIXES = ['k', 'M', 'G', 'T', 'P', 'm', 'μ', 'n'];

/**
 * 生成所有带词头的单位。
 * 例如 m → mm, cm, dm, m, km, Mm, Gm, Tm 等
 */
function generateAllUnits(): string[] {
  const all: Set<string> = new Set();

  // 添加基础单位
  for (const u of BASE_UNIT_SET) all.add(u);

  // 为可加词头的单位添加前缀变体
  for (const unit of PREFIXABLE_UNITS) {
    for (const prefix of SI_PREFIX_NAMES) {
      if (unit === 'kg') continue; // kg 已是基本单位
      // 跳过会产生歧义的组合
      if (prefix === 'd' && unit === 'm') continue; // dm 合法
      if (prefix === 'c' && unit === 'm') continue; // cm 合法
      if (prefix === 'm' && unit === 'm') continue; // mm 合法
      if (prefix === 'a' && unit === 'm') continue; // am 合法（阿米，极罕见）
      if (prefix === 'h' && unit === 'm') continue; // hm 合法
      if (prefix === 'da' && unit === 'm') continue; // dam 合法

      // μ + m = μm, μ + g = μg
      // k + m = km, M + m = Mm
      const prefixed = prefix + unit;
      // 过滤掉不合理组合（如 μ + kg = μkg，前缀通常不叠在 kg 前）
      if (unit === 'kg' && prefix !== 'k') continue;
      if (unit === 'g' && prefix === 'k') { all.add('kg'); continue; }

      all.add(prefixed);
    }
  }

  // eV 特殊前缀
  for (const p of ELECTRONVOLT_PREFIXES) {
    all.add(p + 'eV');
  }

  // Wh 系列
  for (const p of ['k', 'M', 'G', 'T', 'm']) {
    all.add(p + 'Wh');
    all.add(p + 'W');
  }

  // 添加面积/体积/复合单位
  const extraComposites = [
    'm²', 'cm²', 'mm²', 'km²', 'm³', 'cm³', 'mm³', 'dm³',
    'm/s', 'km/h', 'km/s', 'cm/s', 'mm/s', 'm·s⁻¹', 'km·h⁻¹',
    'm/s²', 'cm/s²',
    'kg/m³', 'g/cm³', 'kg·m⁻³', 'g·cm⁻³',
    'N·m', 'J·s', 'W·m⁻²', 'V·m⁻¹', 'N/C', 'T·m',
    'J/kg', 'J·kg⁻¹', 'J/(kg·K)', 'J·kg⁻¹·K⁻¹',
    'W/(m·K)', 'W·m⁻¹·K⁻¹',
    'Pa·s', 'm²/s', 'N·s/m²',
    'C/kg', 'A/m', 'A/m²', 'V/m',
    'F/m', 'H/m', 'Ω·m', 'S/m',
    'lm/W', 'lx·s',
    'mol/L', 'mol·L⁻¹', 'g/mol', 'g·mol⁻¹',
    'Bq/kg', 'Bq·kg⁻¹', 'Gy/s',
    'kWh', 'MWh', 'GWh', 'TWh',
  ];
  for (const u of extraComposites) all.add(u);

  // 添加升的变体
  all.add('mL');
  all.add('μL');
  all.add('nL');
  all.add('pL');
  all.add('kL');

  return Array.from(all).sort((a, b) => b.length - a.length); // 长的优先匹配
}

/** 完整单位列表（含所有前缀组合） */
export const ALL_UNITS: string[] = generateAllUnits();

/** 完整单位 Set */
export const ALL_UNITS_SET: Set<string> = new Set(ALL_UNITS);

// ============================================================
// 三、物理量符号 — 必须斜体
// ============================================================

export const PHYSICAL_QUANTITIES_LATIN = new Set([
  // 力学
  'm', 'F', 'a', 'v', 'g', 'r', 'd', 't', 'T',
  'p', 'P', 'W', 'E', 'h', 'k', 'I', 'U', 'R',
  'B', 'Q', 'q', 'e', 'c', 'n', 's', 'V', 'S',
  'x', 'y', 'z', 'l', 'J', 'N', 'L', 'C', 'G', 'H', 'D',
  'i', 'j',
]);

export const PHYSICAL_QUANTITIES_GREEK = new Set([
  'α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'ν',
  'ρ', 'σ', 'τ', 'φ', 'ω', 'Φ', 'Ω', 'Δ', 'Π', 'Σ',
]);

// ============================================================
// 四、数学常数与函数名 — 必须正体
// ============================================================

export const MATH_CONSTANTS = new Set(['π', 'e', 'i']);

export const MATH_FUNCTIONS = [
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'coth',
  'log', 'lg', 'ln',
  'lim', 'max', 'min', 'sup', 'inf',
  'det', 'gcd', 'arg', 'deg', 'dim', 'exp', 'hom', 'ker', 'Pr',
];

// ============================================================
// 五、下标规范
// ============================================================

export const PROPERTY_SUBSCRIPTS = new Set([
  '0', 't', 'k', 'p', 'max', 'min', 'av', 'rms', 'th',
  'c', 'e', 'eff', 'tot', 'ext', 'int', 'rev', 'abs', 'rel', 'sat',
]);

export const CHEMICAL_SUBSCRIPTS = new Set([
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
  'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
  'K', 'Ca', 'Fe', 'Cu', 'Zn', 'Ag', 'Au', 'Hg', 'Pb',
  'e', 'p', 'n', 'α', 'β', 'γ',
]);

// ============================================================
// 六、选择题选项标签（必须正体 + 全角点号）
// ============================================================

const OPTION_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * 将选项文本中的半角点号 . 替换为全角点号 ．
 * 并将选项标签字母强制为正体。
 * 例："A. xxx" → "<span class='opt-label'>A．</span>xxx"
 */
export function formatOptionLabel(option: string): string {
  // 匹配选项开头：A. / B. / C. 等（半角点号）
  return option.replace(
    /^([A-Z])\.\s*/,
    (_m: string, label: string) =>
      `<span class="opt-label" style="font-style:normal;font-weight:600;">${label}．</span>`
  );
}

/**
 * 批量格式化选项列表
 */
export function formatOptionLabels(options: string[]): string[] {
  return options.map(formatOptionLabel);
}

// ============================================================
// 七、数字+单位检测（核心规则）
// ============================================================

/**
 * 检测文本中 "数字 + 空格 + 单位" 的模式。
 * 这是最可靠的单位判断规则——前面有数字的字母必为单位（正体）。
 *
 * 匹配示例：
 *   "5 m"    → m 是单位
 *   "10 km"  → km 是单位
 *   "3.0×10⁸ m/s" → m/s 是单位
 *   "E = 5 J" → J 是单位
 *   "距离 10 km" → km 是单位
 */
const NUMBER_UNIT_RE = /(\d+(?:\.\d+)?(?:[×xX]\s*10\s*[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]*)?)\s*([A-Za-zμÅΩ°]+(?:\s*[/·]\s*[A-Za-zμÅΩ°]+)*(?:\s*[⁻¹²³⁴⁵⁶⁷⁸⁹⁰]+)?)/g;

/**
 * 从纯文本中提取所有「数字 + 单位」的位置区间。
 * 返回应保持正体的区间列表。
 */
function findNumberUnitRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const re = NUMBER_UNIT_RE;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const unitPart = m[2];
    const unitStart = m.index + m[1].length;
    const unitEnd = unitStart + m[0].length - m[1].length;
    // 检查提取的单位是否在已知单位集合中
    const normalized = unitPart.replace(/\s+/g, '').replace(/[·⁻¹²³⁴⁵⁶⁷⁸⁹⁰]/g, '');
    // 拆分复合单位
    const parts = unitPart.split(/[/·]/);
    for (const part of parts) {
      const clean = part.replace(/[⁻¹²³⁴⁵⁶⁷⁸⁹⁰\s]/g, '');
      if (ALL_UNITS_SET.has(clean) || /^[A-Za-zμÅΩ°]+$/.test(clean)) {
        ranges.push({ start: unitStart, end: unitEnd });
        break; // 整个单位块标记为正体
      }
    }
  }
  // 合并重叠区间
  return mergeRanges(ranges);
}

function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

// ============================================================
// 八、HTML 文本物理学科字体规范应用
// ============================================================

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 对非数学模式（HTML）中的纯文本段落应用物理学科字体规范。
 *
 * 处理顺序：
 *   1. 检测「数字 + 单位」 → 包裹为 <u>（正体标记）
 *   2. 检测独立已知单位 → 包裹为 <u>
 *   3. 检测物理量符号 → 包裹为 <i>（斜体）
 *   4. 检测数学常数 → 保持正体
 *   5. 检测数学函数名 → 保持正体
 */
export function applyPhysicsNotationToHTML(html: string): string {
  let result = html;

  // Step 1: 标记「数字 + 单位」为正体（最高优先级）
  // 使用临时标记避免被后续替换干扰
  const unitMarkers: Array<{ placeholder: string; original: string }> = [];

  // 先标记所有数字+单位组合
  result = result.replace(NUMBER_UNIT_RE, (match, number, unit) => {
    const placeholder = ` UNIT${unitMarkers.length} `;
    unitMarkers.push({ placeholder, original: match });
    return placeholder;
  });

  // Step 2: 在非数字后的上下文中，标记独立已知单位为 <u>
  // 按长度降序遍历所有单位
  for (const unit of ALL_UNITS) {
    if (unit.length < 2 && 'mMsSgGhHtT'.includes(unit)) continue; // 单字母可能是物理量
    const re = new RegExp(
      `(?<![a-zA-Z\\d])(?<!<[^>]{0,100})${escapeRegex(unit)}(?![a-zA-Z\\d])(?!>)`,
      'g'
    );
    result = result.replace(re, (m) => {
      // 检查是否在已标记的单位区间内
      for (const marker of unitMarkers) {
        if (marker.placeholder.includes(m)) return m;
      }
      return `<u>${m}</u>`;
    });
  }

  // Step 3: 标记物理量拉丁字母为斜体
  for (const sym of PHYSICAL_QUANTITIES_LATIN) {
    // 跳过同时是单位的单字母（由上下文判断）
    if (ALL_UNITS_SET.has(sym) && sym.length === 1) continue;
    const re = new RegExp(
      `(?<![a-zA-Z\\d<>])${escapeRegex(sym)}(?![a-zA-Z\\d<>])`,
      'g'
    );
    result = result.replace(re, `<i>${sym}</i>`);
  }

  // Step 4: 标记物理量希腊字母为斜体
  for (const sym of PHYSICAL_QUANTITIES_GREEK) {
    if (sym === 'μ' || sym === 'Ω') continue; // 可能是单位
    const re = new RegExp(`(?<![\\w<>])${escapeRegex(sym)}(?![\\w<>])`, 'g');
    result = result.replace(re, `<i>${sym}</i>`);
  }

  // 还原临时占位符
  for (const marker of unitMarkers.reverse()) {
    result = result.replace(marker.placeholder, marker.original);
  }

  return result;
}

// ============================================================
// 九、HTML 文本中丢失的上/下角标恢复
// ============================================================

/**
 * 检测并恢复 HTML 文本中丢失的上角标/下角标格式。
 *
 * 常见丢失模式（通常在 Word 导入或纯文本粘贴时发生）：
 *   ×10^7   → ×10<sup>7</sup>    （科学记数法）
 *   m^2     → m<sup>2</sup>       （上标）
 *   v_0     → v<sub>0</sub>       （下标）
 *   ×10^-3  → ×10<sup>-3</sup>    （负指数）
 *
 * 注意：此函数仅处理 $$...$$ / $...$ 之外的文本，
 * 数学模式内的上下标由 KaTeX 自动处理。
 */
export function restoreSuperscriptsAndSubscripts(text: string): string {
  let result = text;

  // 1. ×10^N 或 ×10^-N → 上标（科学记数法，最高优先级）
  result = result.replace(
    /(×\s*10)\^(\-?\d+)/g,
    '$1<sup>$2</sup>'
  );

  // 2. ×10 后面直接跟 1-2 位数字（无 ^，丢失了格式）
  //    仅在数字后跟空格、单位、逗号、句号或行尾时处理
  result = result.replace(
    /(×\s*10)(\d{1,2})(?=\s|[A-Za-z一-鿿]|[,.;，。；]|$)/g,
    '$1<sup>$2</sup>'
  );

  // 3. 字母/数字后跟 ^数字 → 上标（注意：不在 < 或 > 内）
  result = result.replace(
    /([a-zA-Z\d\)\]])[\^](\-?\d+)/g,
    '$1<sup>$2</sup>'
  );

  // 4. 希腊字母后跟 ^数字 → 上标
  result = result.replace(
    /([αβγδεθλμνρστφω])[\^](\-?\d+)/g,
    '$1<sup>$2</sup>'
  );

  // 5. _X 下标模式（不在数学模式内，非HTML标签）
  //    v_0 → v<sub>0</sub>, m_e → m<sub>e</sub>, m_H → m<sub>H</sub>
  result = result.replace(
    /([a-zA-Zαβγδεθλμνρστφω])_(\{?)([a-zA-Z\dαβγδεθλμνρστφω]+)(\}?)/g,
    (_m: string, base: string, openBrace: string, sub: string, closeBrace: string) => {
      // 检查是否在 HTML 标签内
      return `${base}<sub>${sub}</sub>`;
    }
  );

  return result;
}

// ============================================================
// 十、选项文本格式化
// ============================================================

/**
 * 对整道题目的选项列表应用格式规范。
 * 包括：选项标签正体 + 全角点号、选项内容中物理量的斜体。
 */
export function formatChoiceOptions(options: string[]): string[] {
  return options.map((opt) => {
    // 1. 格式化选项标签
    let formatted = formatOptionLabel(opt);
    // 2. 选项内容中应用物理规范（但保留已格式化的标签）
    const labelEnd = formatted.indexOf('</span>');
    if (labelEnd > 0) {
      const prefix = formatted.slice(0, labelEnd + 7);
      const content = formatted.slice(labelEnd + 7);
      formatted = prefix + applyPhysicsNotationToHTML(content);
    }
    return formatted;
  });
}

// ============================================================
// 十、KaTeX 宏辅助
// ============================================================

export const PHYSICS_KATEX_GLOBAL_MACROS: Record<string, string> = {
  '\\vect': '\\boldsymbol{#1}',
  '\\dd': '\\,\\mathrm{d}',
  '\\DD': '\\mathrm{d}',
  '\\pp': '\\partial',
  '\\eu': '\\mathrm{e}',
  '\\iu': '\\mathrm{i}',
  '\\unitms': '\\mathrm{m \\cdot s^{-1}}',
  '\\unitkmh': '\\mathrm{km \\cdot h^{-1}}',
  '\\unitNs': '\\mathrm{N \\cdot s}',
  '\\unitJkg': '\\mathrm{J \\cdot kg^{-1}}',
  '\\unitWmK': '\\mathrm{W \\cdot m^{-1} \\cdot K^{-1}}',
  '\\Dl': '\\mathrm{\\Delta}',
  '\\avg': '\\overline{#1}',
};

export const PHYSICS_KATEX_MACROS: Record<string, string> = {
  velocity: 'v', acceleration: 'a', force: 'F', mass: 'm',
  momentum: 'p', energy: 'E', kineticEnergy: 'E_{\\mathrm{k}}',
  potentialEnergy: 'E_{\\mathrm{p}}', work: 'W', power: 'P',
  angularVelocity: '\\omega', angularAcceleration: '\\alpha',
  torque: '\\tau', momentOfInertia: 'I', angularMomentum: 'L',
  gravitationalAccel: 'g', radius: 'r', distance: 'd', time: 't',
  period: 'T', frequency: '\\nu', wavelength: '\\lambda',
  density: '\\rho', pressure: 'p', volume: 'V', temperature: 'T',
  entropy: 'S', charge: 'q', elementaryCharge: 'e',
  electricField: 'E', magneticField: 'B', electricPotential: 'V',
  current: 'I', resistance: 'R', capacitance: 'C', inductance: 'L',
  permittivity: '\\varepsilon', permeability: '\\mu',
  conductivity: '\\sigma', resistivity: '\\rho',
  magneticFlux: '\\varPhi', refractiveIndex: 'n',
  focalLength: 'f', planck: 'h', reducedPlanck: '\\hbar',
  speedOfLight: 'c', boltzmann: 'k',
  avogadro: 'N_{\\mathrm{A}}', rydberg: 'R_{\\infty}',
  unitMeter: '\\mathrm{m}', unitSecond: '\\mathrm{s}',
  unitKilogram: '\\mathrm{kg}', unitNewton: '\\mathrm{N}',
  unitJoule: '\\mathrm{J}', unitWatt: '\\mathrm{W}',
  unitAmpere: '\\mathrm{A}', unitVolt: '\\mathrm{V}',
  unitOhm: '\\Omega', unitTesla: '\\mathrm{T}',
  unitHertz: '\\mathrm{Hz}', unitPascal: '\\mathrm{Pa}',
  unitCoulomb: '\\mathrm{C}', unitFarad: '\\mathrm{F}',
  unitHenry: '\\mathrm{H}', unitKelvin: '\\mathrm{K}',
  unitMole: '\\mathrm{mol}', pi: '\\pi', euler: '\\mathrm{e}',
  imaginary: '\\mathrm{i}',
};

export function createKaTeXPhysicsOptions(displayMode: boolean) {
  return {
    displayMode,
    throwOnError: false,
    strict: false as const,
    macros: PHYSICS_KATEX_GLOBAL_MACROS,
  };
}
