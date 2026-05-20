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
 * 在 KaTeX 数学模式（$$...$$ / $...$）中：
 *   - 变量自动斜体，无需额外标记
 *   - 单位需用 \mathrm{} 或 \text{} 包裹
 *   - 函数名用内置命令：\sin \cos \tan \log \lim \max \min \ln \det \gcd \arg
 *   - 微分符号：\mathrm{d} 或 \,\mathrm{d}
 *   - 向量：\boldsymbol{F} 或 \vec{F}
 *   - 数学常数：\mathrm{e}（自然常数）、\pi（圆周率，KaTeX 默认正体）
 */

// ============================================================
// 一、物理量符号 — 必须斜体
// ============================================================

/** 拉丁字母物理量（斜体） */
export const PHYSICAL_QUANTITIES_LATIN = new Set([
  // 力学
  'm',   // 质量 mass
  'F',   // 力 force
  'a',   // 加速度 acceleration
  'v',   // 速度 velocity
  'g',   // 重力加速度 gravitational acceleration
  'r',   // 半径 radius
  'd',   // 距离 distance
  't',   // 时间 time
  'T',   // 周期 period / 温度 temperature
  'p',   // 动量 momentum
  'P',   // 功率 power
  'W',   // 功 work
  'E',   // 能量 energy
  'h',   // 高度 height / 普朗克常数
  'k',   // 劲度系数 / 静电力常量 / 玻尔兹曼常数
  'I',   // 电流 current / 转动惯量
  'U',   // 电压 voltage
  'R',   // 电阻 resistance
  'B',   // 磁感应强度 magnetic flux density
  'Q',   // 电荷量 charge
  'q',   // 电荷量 charge
  'e',   // 元电荷 elementary charge（物理量，非自然常数时斜体）
  'c',   // 光速 speed of light / 比热容
  'n',   // 折射率 / 物质的量
  's',   // 路程 / 弧长
  'V',   // 体积
  'S',   // 面积
  'x', 'y', 'z', // 坐标
  'l',   // 长度
  'J',   // 转动惯量 / 电流密度
  'N',   // 支持力 normal force（非单位时）
  'L',   // 角动量 / 电感
  'C',   // 电容
  'G',   // 万有引力常量
  'H',   // 磁场强度
  'D',   // 电位移
  // 下标变量索引
  'i', 'j', 'n', // 索引变量
]);

/** 希腊字母物理量（斜体） */
export const PHYSICAL_QUANTITIES_GREEK = new Set([
  'α', // alpha — 角加速度、精细结构常数
  'β', // beta  — 速度/c 的比值
  'γ', // gamma — 洛伦兹因子
  'δ', // delta — 微小变化量（物理量增量）
  'ε', // epsilon — 介电常数 / 应变
  'θ', // theta — 角度
  'λ', // lambda — 波长 / 衰变常数
  'μ', // mu — 摩擦系数 / 磁导率 / 约化质量
  'ν', // nu — 频率 / 泊松比
  'ρ', // rho — 密度 / 电阻率
  'σ', // sigma — 应力 / 电导率 / 标准差
  'τ', // tau — 扭矩 / 时间常数
  'φ', // phi — 相位 / 电势 / 磁通量
  'ω', // omega — 角速度 / 角频率
  'Φ', // Phi — 磁通量
  'Ω', // Omega — 欧姆（单位正体）/ 立体角（物理量斜体）
  'Δ', // Delta — 增量（运算符）/ 变化量（物理量）
  'Π', // Pi — 乘积
  'Σ', // Sigma — 求和
]);

// ============================================================
// 二、单位符号 — 必须正体
// ============================================================

/** 国际单位制基本单位及导出单位（正体） */
export const UNIT_SYMBOLS = new Set([
  'm',   // 米
  's',   // 秒
  'kg',  // 千克
  'A',   // 安培
  'K',   // 开尔文
  'N',   // 牛顿
  'Hz',  // 赫兹
  'J',   // 焦耳
  'W',   // 瓦特
  'V',   // 伏特
  'Pa',  // 帕斯卡
  'C',   // 库仑
  'T',   // 特斯拉
  'H',   // 亨利
  'F',   // 法拉
  'Ω',   // 欧姆
  'S',   // 西门子
  'Wb',  // 韦伯
  'eV',  // 电子伏特
  'mol', // 摩尔
  'cd',  // 坎德拉
  'rad', // 弧度
  'sr',  // 球面度
  'Bq',  // 贝可勒尔
  'Gy',  // 戈瑞
  'Sv',  // 希沃特
  'kat', // 开特
  'lm',  // 流明
  'lx',  // 勒克斯
  'L',   // 升
  't',   // 吨
  'h',   // 小时
  'min', // 分钟
  'u',   // 原子质量单位
  'AU',  // 天文单位
]);

/** 希腊字母单位符号（正体） */
export const UNIT_SYMBOLS_GREEK = new Set([
  'μ', // 微 (10⁻⁶)
  'Ω', // 欧姆
]);

/** 单位前缀（正体） */
export const UNIT_PREFIXES = new Set([
  'T', 'G', 'M', 'k', 'h', 'da', 'd', 'c', 'm', 'μ', 'n', 'p', 'f', 'a', 'z', 'y',
]);

// ============================================================
// 三、数学常数与符号 — 必须正体
// ============================================================

/** 数学常数（正体） */
export const MATH_CONSTANTS = new Set([
  'π',   // 圆周率 pi
  'e',   // 自然常数（区别于元电荷 e，须用 \mathrm{e}）
  'i',   // 虚数单位
]);

/** 标准数学函数（KaTeX 内置正体命令） */
export const MATH_FUNCTIONS = [
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'coth',
  'log', 'lg', 'ln',
  'lim', 'max', 'min', 'sup', 'inf',
  'det', 'gcd', 'arg', 'deg', 'dim', 'exp', 'hom', 'ker',
  'Pr',
];

/** 运算符（正体） */
export const MATH_OPERATORS = new Set([
  '∑', // 求和
  '∏', // 求积
  '∫', // 积分
  '∂', // 偏微分
  'Δ', // 增量（Laplace 算子）
  '∇', // 梯度/散度/旋度算子
]);

// ============================================================
// 四、下标与上标规范
// ============================================================

/**
 * 下标含义 → 字体规则：
 *   - 属性描述（初、末、最大、最小、临界）→ 正体 \mathrm{}
 *   - 变量索引（i, j, k, n）→ 斜体（默认）
 *   - 化学元素/物质 → 正体 \mathrm{}
 *
 * 常用属性下标（正体）：
 *   ₀ — 初始 initial       v₀ = v_{\mathrm{0}}
 *   t  — 末态 terminal      v_t = v_{\mathrm{t}}
 *   k  — 动能 kinetic       E_k = E_{\mathrm{k}}
 *   p  — 势能 potential     E_p = E_{\mathrm{p}}
 *   max — 最大值 maximum    v_{\mathrm{max}}
 *   min — 最小值 minimum    v_{\mathrm{min}}
 *   H  — 氢 hydrogen       m_H = m_{\mathrm{H}}
 *   e  — 电子 electron     m_e = m_{\mathrm{e}}
 *   c  — 临界 critical     T_c = T_{\mathrm{c}}
 */

/** 物理量属性下标（应在 KaTeX 中用 \mathrm{} 包裹为正体） */
export const PROPERTY_SUBSCRIPTS = new Set([
  '0',    // 初始
  't',    // 末态
  'k',    // 动能 kinetic
  'p',    // 势能 potential
  'max',  // 最大
  'min',  // 最小
  'av',   // 平均 average
  'rms',  // 均方根
  'th',   // 热 thermal
  'c',    // 临界 critical
  'e',    // 电子 / 有效 effective
  'eff',  // 有效
  'tot',  // 总和 total
  'ext',  // 外部 external
  'int',  // 内部 internal
  'rev',  // 可逆 reversible
  'abs',  // 绝对 absolute
  'rel',  // 相对 relative
  'sat',  // 饱和 saturated
]);

/** 化学元素/粒子下标（正体） */
export const CHEMICAL_SUBSCRIPTS = new Set([
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
  'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
  'K', 'Ca', 'Fe', 'Cu', 'Zn', 'Ag', 'Au', 'Hg', 'Pb',
  'e',   // 电子
  'p',   // 质子
  'n',   // 中子
  'α',   // alpha 粒子
  'β',   // beta 粒子
  'γ',   // gamma 光子
]);

// ============================================================
// 五、向量与张量
// ============================================================

/**
 * 向量：粗斜体（KaTeX: \boldsymbol{F} 或带箭头 \vec{F}）
 * 向量大小（标量）：斜体（KaTeX: F）
 * 张量：黑体（KaTeX: \mathbf{T} 或 \mathsf{T}）
 */

// ============================================================
// 六、常用物理量 KaTeX 模板（预定义宏）
// ============================================================

/** 常用物理量在 KaTeX 中的正确写法 */
export const PHYSICS_KATEX_MACROS: Record<string, string> = {
  // 力学
  velocity: 'v',
  acceleration: 'a',
  force: 'F',
  mass: 'm',
  momentum: 'p',
  energy: 'E',
  kineticEnergy: 'E_{\\mathrm{k}}',
  potentialEnergy: 'E_{\\mathrm{p}}',
  work: 'W',
  power: 'P',
  angularVelocity: '\\omega',
  angularAcceleration: '\\alpha',
  torque: '\\tau',
  momentOfInertia: 'I',
  angularMomentum: 'L',
  gravitationalAccel: 'g',
  radius: 'r',
  distance: 'd',
  time: 't',
  period: 'T',
  frequency: '\\nu',
  wavelength: '\\lambda',
  waveNumber: 'k',
  density: '\\rho',
  pressure: 'p',
  volume: 'V',
  temperature: 'T',
  entropy: 'S',

  // 电磁学
  charge: 'q',
  elementaryCharge: 'e',
  electricField: 'E',
  magneticField: 'B',
  electricPotential: 'V',
  current: 'I',
  resistance: 'R',
  capacitance: 'C',
  inductance: 'L',
  permittivity: '\\varepsilon',
  permeability: '\\mu',
  conductivity: '\\sigma',
  resistivity: '\\rho',
  magneticFlux: '\\varPhi',
  electricDipole: 'p',
  magneticDipole: 'm',

  // 光学
  refractiveIndex: 'n',
  focalLength: 'f',
  objectDistance: 'u',
  imageDistance: 'v',
  magnification: 'M',

  // 现代物理
  planck: 'h',
  reducedPlanck: '\\hbar',
  speedOfLight: 'c',
  boltzmann: 'k',
  avogadro: 'N_{\\mathrm{A}}',
  rydberg: 'R_{\\infty}',

  // 单位（须用 \mathrm{} 保持正体）
  unitMeter: '\\mathrm{m}',
  unitSecond: '\\mathrm{s}',
  unitKilogram: '\\mathrm{kg}',
  unitNewton: '\\mathrm{N}',
  unitJoule: '\\mathrm{J}',
  unitWatt: '\\mathrm{W}',
  unitAmpere: '\\mathrm{A}',
  unitVolt: '\\mathrm{V}',
  unitOhm: '\\Omega',
  unitTesla: '\\mathrm{T}',
  unitHertz: '\\mathrm{Hz}',
  unitPascal: '\\mathrm{Pa}',
  unitCoulomb: '\\mathrm{C}',
  unitFarad: '\\mathrm{F}',
  unitHenry: '\\mathrm{H}',
  unitKelvin: '\\mathrm{K}',
  unitMole: '\\mathrm{mol}',

  // 数学常数（正体）
  pi: '\\pi',
  euler: '\\mathrm{e}',
  imaginary: '\\mathrm{i}',
};

// ============================================================
// 七、内容预处理
// ============================================================

/**
 * 检测内容中是否包含可能违反物理学科正斜体规范的写法。
 * 返回警告信息列表。
 */
export function checkNotationWarnings(content: string): string[] {
  const warnings: string[] = [];

  // 检查 $$ 块外是否有疑似物理量未使用斜体标记
  const outsideMath = content.replace(/\$\$[\s\S]*?\$\$/g, '').replace(/\$[^$]+?\$/g, '');

  // 检查常见错误：单位使用斜体标记
  const unitInItalic = /<[iI]\s*>\s*(m|s|kg|N|A|Hz|J|W|V|Pa|C|T|Ω|H|F|eV)\s*<\/[iI]>/g;
  let m: RegExpExecArray | null;
  while ((m = unitInItalic.exec(outsideMath)) !== null) {
    warnings.push(`单位 "${m[1]}" 不应使用斜体（单位须为正体），位于位置 ${m.index}`);
  }

  return warnings;
}

/**
 * 对非数学模式（HTML）中的内容应用物理学科字体规范。
 * 将已知物理量符号包裹在 <i> 标签中，保留单位正体。
 *
 * 注意：此函数不做修改——仅做标注。实际渲染由 KaTeX（数学模式）
 * 和 CSS（HTML 模式）控制。
 */
export function applyPhysicsNotationToHTML(html: string): string {
  const latinSymbols = Array.from(PHYSICAL_QUANTITIES_LATIN).filter(sym => /^[A-Za-z]$/.test(sym));
  const greekSymbols = ['\u03b1', '\u03b2', '\u03b3', '\u03b4', '\u03b5', '\u03b8', '\u03bb', '\u03bc', '\u03bd', '\u03c1', '\u03c3', '\u03c4', '\u03c6', '\u03c9', '\u03a6', '\u03a9', '\u0394', '\u03a0', '\u03a3'];
  const unitCore = String.raw`(?:da|[YZEPTGMkhdcmu\u03bcnpfazy])?(?:kg|mol|rad|sr|Hz|Pa|Wb|eV|N|J|W|V|A|K|C|T|H|F|S|m|s|g|\u03a9|ohm)`;
  const unitExpr = String.raw`${unitCore}(?:\s*(?:[\u00b7*\u00d7x/]|(?:\^|\u2212|-)?\d+)\s*${unitCore}?)*`;
  const numberUnitRe = new RegExp(String.raw`(\d+(?:\.\d+)?)(\s|&nbsp;)*(${unitExpr})`, 'g');

  const processText = (text: string) => {
    const protectedUnits: string[] = [];
    const italicTokens: string[] = [];
    let next = text.replace(numberUnitRe, (_match, number: string, space: string = '', unit: string) => {
      const token = `@@PHYSICS_UNIT_${protectedUnits.length}@@`;
      protectedUnits.push(`<span class="physics-unit">${unit}</span>`);
      return `${number}${space || ''}${token}`;
    });

    next = next.replace(/(^|[^A-Za-z\d_])([A-Za-z])(?![A-Za-z\d_])/g, (match, prefix: string, sym: string) => {
      if (!latinSymbols.includes(sym)) return match;
      const token = `@@PHYSICS_ITALIC_${italicTokens.length}@@`;
      italicTokens.push(`<i>${sym}</i>`);
      return `${prefix}${token}`;
    });

    const greekPattern = greekSymbols.map(escapeRegex).join('|');
    next = next.replace(new RegExp(`(^|[^\\w])(${greekPattern})(?![\\w])`, 'g'), (match, prefix: string, sym: string) => {
      const token = `@@PHYSICS_ITALIC_${italicTokens.length}@@`;
      italicTokens.push(`<i>${sym}</i>`);
      return `${prefix}${token}`;
    });

    return next
      .replace(/@@PHYSICS_ITALIC_(\d+)@@/g, (_token, index) => italicTokens[Number(index)] || '')
      .replace(/@@PHYSICS_UNIT_(\d+)@@/g, (_token, index) => protectedUnits[Number(index)] || '');
  };

  return html
    .split(/(<[^>]+>)/g)
    .map(part => part.startsWith('<') ? part : processText(part))
    .join('');
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// 八、KaTeX 宏辅助
// ============================================================

/**
 * 生成 KaTeX 宏定义字符串，可用于 \gdef。
 * 例如在 KaTeX options.macros 中使用。
 */
export const PHYSICS_KATEX_GLOBAL_MACROS: Record<string, string> = {
  // 向量
  '\\vect': '\\boldsymbol{#1}',
  // 微分符号（正体 d）
  '\\dd': '\\,\\mathrm{d}',
  '\\DD': '\\mathrm{d}',
  // 偏微分
  '\\pp': '\\partial',
  // 自然常数（正体）
  '\\eu': '\\mathrm{e}',
  // 虚数单位（正体）
  '\\iu': '\\mathrm{i}',
  // 常见复合单位
  '\\unitms': '\\mathrm{m \\cdot s^{-1}}',
  '\\unitkmh': '\\mathrm{km \\cdot h^{-1}}',
  '\\unitNs': '\\mathrm{N \\cdot s}',
  '\\unitJkg': '\\mathrm{J \\cdot kg^{-1}}',
  '\\unitWmK': '\\mathrm{W \\cdot m^{-1} \\cdot K^{-1}}',
  // 增量（正体 Δ）
  '\\Dl': '\\mathrm{\\Delta}',
  // 平均值
  '\\avg': '\\overline{#1}',
};

/**
 * 为 KaTeX renderToString 生成带物理学科全局宏的 options。
 */
export function createKaTeXPhysicsOptions(displayMode: boolean) {
  return {
    displayMode,
    throwOnError: false,
    strict: false as const,
    macros: PHYSICS_KATEX_GLOBAL_MACROS,
  };
}
