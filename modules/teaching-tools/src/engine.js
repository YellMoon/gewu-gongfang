/**
 * 教学工具渲染引擎 v1.0
 * 服务端执行插件逻辑，返回结果数据供小程序渲染
 *
 * 支持的插件：
 * - wave-demo: 机械波模拟器 → 返回波型数据点
 */
function executeWaveDemo(params) {
  const {
    waveType = 'transverse',
    frequency = 1,
    amplitude = 2,
    wavelength = 4,
    damping = 0,
    time = Date.now() / 1000,
    points = 200,
    length = 20,
  } = params || {};

  const omega = 2 * Math.PI * frequency;
  const k = (2 * Math.PI) / wavelength;
  const t = time || 0;

  const data = [];
  const xValues = [];

  // 生成 x 轴
  for (let i = 0; i < points; i++) {
    xValues.push((i / points) * length);
  }

  // 计算 y 值
  for (let i = 0; i < points; i++) {
    const x = xValues[i];
    let y = 0;

    switch (waveType) {
      case 'transverse':
        // 横波: y = A * sin(kx - ωt)
        y = amplitude * Math.sin(k * x - omega * t);
        break;

      case 'longitudinal':
        // 纵波: 密度变化 = A * sin(kx - ωt)，y 表示疏密程度
        y = amplitude * 0.5 * Math.sin(k * x - omega * t);
        break;

      case 'standing':
        // 驻波: y = 2A * sin(kx) * cos(ωt)
        y = 2 * amplitude * Math.sin(k * x) * Math.cos(omega * t);
        break;

      case 'damped':
        // 阻尼波: y = A * e^(-damping*x) * sin(kx - ωt)
        y = amplitude * Math.exp(-damping * x) * Math.sin(k * x - omega * t);
        break;

      default:
        y = amplitude * Math.sin(k * x - omega * t);
    }

    data.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  }

  // 波属性
  const period = 1 / frequency;
  const speed = frequency * wavelength;

  return {
    type: 'wave-data',
    waveType,
    metadata: {
      frequency,
      amplitude,
      wavelength,
      damping,
      period: Math.round(period * 100) / 100,
      speed: Math.round(speed * 100) / 100,
      waveTypeLabel: getWaveTypeLabel(waveType),
    },
    data,
    renderHint: {
      viewport: { x: [0, length], y: [-amplitude * 1.5, amplitude * 1.5] },
    },
  };
}

function getWaveTypeLabel(type) {
  const labels = {
    transverse: '横波',
    longitudinal: '纵波',
    standing: '驻波',
    damped: '阻尼波',
  };
  return labels[type] || type;
}

const EXECUTORS = {
  'wave-demo': executeWaveDemo,
};

/**
 * 执行教学工具
 * @param {string} toolId
 * @param {object} params
 * @returns {{ code: number, data?: any, error?: string }}
 */
function executeTool(toolId, params) {
  const executor = EXECUTORS[toolId];
  if (!executor) {
    return {
      code: -1,
      error: `工具 "${toolId}" 的服务端渲染引擎未实现`,
    };
  }

  try {
    const result = executor(params);
    return { code: 0, data: result };
  } catch (err) {
    return {
      code: -1,
      error: `执行出错: ${err.message}`,
    };
  }
}

module.exports = { executeTool, EXECUTORS };
