import React, { useRef, useEffect, useCallback, useState } from 'react';

interface WaveVisualizationProps {
  amplitude1?: number;
  frequency1?: number;
  wavelength1?: number;
  amplitude2?: number;
  frequency2?: number;
  wavelength2?: number;
  dualMedium?: boolean;
  v1?: number;
  v2?: number;
  x1Boundary?: number;
  showParticles?: boolean;
  width?: number;
  /** Speed multiplier (0.25 | 0.5 | 1 | 2 | 4) */
  speedMultiplier?: number;
  /** Wave propagation direction */
  direction?: 'left' | 'right';
  /** Wave source position */
  sourcePosition?: 'left' | 'center' | 'right';
  /** If true, render internal control panel; if false, use only props */
  renderControls?: boolean;
}

// ── Colors ──
const COLORS = {
  wave1: '#e74c3c',
  wave2: '#2ecc71',
  combined: '#f39c12',
  bg: '#1a1a2e',
  axis: '#555577',
  grid: '#252545',
  axisLabel: '#8888aa',
  tickLabel: '#666699',
  label: '#aaaacc',
};

// ── Speed multiplier presets ──
const SPEED_PRESETS = [0.25, 0.5, 1, 2, 4] as const;

// ── Canvas constants ──
// CANVAS_H 现在根据振幅动态计算，确保波峰/波谷始终在视口内
function calcCanvasH(amp1: number, amp2: number): number {
  const maxAmp = Math.max(Math.abs(amp1), Math.abs(amp2), 1);
  // 留出60%余量，确保 y 轴标注空间
  const yRange = maxAmp * 2.6;
  const pxPerCm = 200 / 2; // 基准：2cm振幅时200px绘图区
  const plotH = Math.max(120, yRange * pxPerCm);
  return Math.max(280, Math.ceil(plotH + 50)); // 最小高度280px
}

const CANVAS_W = 800;
const CANVAS_H_DEFAULT = 250;
const MARGIN = { left: 60, right: 20, top: 15, bottom: 35 };
const DISPLAY_LEN = 8; // 8 meters on x-axis

// PLOT_H 和 PLOT_W 改为动态计算
function calcPlotH(canvasH: number) { return canvasH - MARGIN.top - MARGIN.bottom; }
function calcPlotW() { return CANVAS_W - MARGIN.left - MARGIN.right; }

// ── Physics helpers ──

/** Compute wave y-value (in cm) at position x (in m) at time t (in s). */
function waveY(
  x: number,
  x0: number,       // source position (m)
  A: number,        // amplitude (cm)
  λ: number,        // wavelength (m)
  v: number,        // phase velocity (m/s)
  t: number,        // time (s)
  dir: 'left' | 'right',
): number {
  const k = (2 * Math.PI) / λ;         // wavenumber
  const ω = (2 * Math.PI * v) / λ;     // angular frequency
  const dx = x - x0;
  let phase: number;
  if (dir === 'right') {
    phase = k * dx - ω * t;
  } else {
    phase = k * dx + ω * t;
  }
  let envelope = 1;
  if (dir === 'right' && dx < 0) {
    envelope = Math.exp(-((dx) ** 2) / 0.6);
  } else if (dir === 'left' && dx > 0) {
    envelope = Math.exp(-((dx) ** 2) / 0.6);
  }
  return A * Math.sin(phase) * envelope;
}

/** Find nice axis scale. */
function niceScale(maxVal: number): { max: number; step: number } {
  const raw = Math.max(maxVal, 0.1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const residual = raw / magnitude;
  let niceStep: number;
  if (residual <= 1.5) niceStep = 0.2 * magnitude;
  else if (residual <= 3.5) niceStep = 0.5 * magnitude;
  else if (residual <= 7) niceStep = 1 * magnitude;
  else niceStep = 2 * magnitude;
  const max = Math.ceil(raw / niceStep) * niceStep;
  return { max, step: niceStep };
}

// ── Canvas drawing ──

type DrawWaveFn = (t: number) => number[]; // returns y-values in canvas coords

function drawCanvas(
  ctx: CanvasRenderingContext2D,
  label: string,           // e.g. "y₁", "y₂", "y合成"
  color: string,
  amp: number,             // amplitude (cm)
  drawWave: DrawWaveFn,    // function producing y-values
  t: number,
  canvasH?: number,        // optional dynamic canvas height
) {
  const dpr = window.devicePixelRatio || 1;
  const _canvasH = canvasH || CANVAS_H_DEFAULT;
  const h = _canvasH * dpr;
  const w = CANVAS_W * dpr;
  ctx.save();
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CANVAS_W, _canvasH);

  const left = MARGIN.left;
  const top = MARGIN.top;
  const bw = calcPlotW();
  const bh = calcPlotH(_canvasH);

  // ── Y-axis scale ──
  const { max: yMax, step: yStep } = niceScale(amp * 1.3);
  const yRange = yMax * 2;
  const pxPerCm = bh / yRange;
  const yOrigin = top + bh / 2;

  // ── X-axis scale ──
  const pxPerM = bw / DISPLAY_LEN;

  // ── Grid ──
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;

  // Horizontal grid lines
  for (let val = -yMax; val <= yMax + 0.001; val += yStep) {
    const y = yOrigin - val * pxPerCm;
    if (y >= top && y <= top + bh) {
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + bw, y);
      ctx.stroke();
    }
  }

  // Vertical grid lines (1m intervals)
  for (let m = 0; m <= DISPLAY_LEN; m++) {
    const x = left + m * pxPerM;
    if (x >= left && x <= left + bw) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + bh);
      ctx.stroke();
    }
  }

  // ── Zero line ──
  ctx.strokeStyle = '#3d3d5c';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(left, yOrigin);
  ctx.lineTo(left + bw, yOrigin);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Axes ──
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1.2;

  // Y-axis
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, top + bh);
  ctx.stroke();

  // X-axis
  ctx.beginPath();
  ctx.moveTo(left, top + bh);
  ctx.lineTo(left + bw, top + bh);
  ctx.stroke();

  // ── Y-axis tick labels ──
  ctx.fillStyle = COLORS.tickLabel;
  ctx.font = '10px "Times New Roman", serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let val = -yMax; val <= yMax + 0.001; val += yStep) {
    const y = yOrigin - val * pxPerCm;
    if (y >= top && y <= top + bh) {
      if (Math.abs(val) < 0.001) {
        ctx.fillText('0', left - 6, y);
      } else {
        ctx.fillText(val.toFixed(Math.abs(val) < 1 ? 1 : 0), left - 6, y);
      }
    }
  }

  // ── X-axis tick labels ──
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let m = 0; m <= DISPLAY_LEN; m++) {
    const x = left + m * pxPerM;
    if (x >= left && x <= left + bw) {
      ctx.fillText(String(m), x, top + bh + 4);
    }
  }

  // ── Axis titles (mathematical italic + upright units) ──
  // "y/cm" – italic y, then upright /cm
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'center';
  ctx.font = 'italic 13px "Times New Roman", serif';
  ctx.fillStyle = COLORS.axisLabel;
  ctx.fillText('y', left - 22, top + bh / 2 + 4);
  ctx.font = '11px "Times New Roman", serif';
  ctx.fillText('/cm', left - 10, top + bh / 2 + 4);

  ctx.textBaseline = 'top';
  ctx.textAlign = 'right';
  ctx.font = 'italic 13px "Times New Roman", serif';
  ctx.fillText('x', left + bw - 2, top + bh + 20);
  ctx.font = '11px "Times New Roman", serif';
  ctx.fillText('/m', left + bw + 10, top + bh + 20);

  // ── Section label (mathematical subscript) ──
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COLORS.label;
  ctx.font = 'italic 14px "Times New Roman", serif';
  ctx.fillText(label.replace('合成', ''), left + 6, top + 3);
  if (label === 'y合成') {
    ctx.font = '10px "Times New Roman", serif';
    ctx.fillText('合成', left + 18, top + 7);
  }

  // ── Wave line ──
  const data = drawWave(t);
  const pts = data.length;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  // Main line
  ctx.beginPath();
  for (let i = 0; i < pts; i++) {
    const x = left + (i / (pts - 1)) * bw;
    if (i === 0) ctx.moveTo(x, data[i]);
    else ctx.lineTo(x, data[i]);
  }
  ctx.stroke();

  // Glow
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.strokeStyle = color + '55';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i < pts; i++) {
    const x = left + (i / (pts - 1)) * bw;
    if (i === 0) ctx.moveTo(x, data[i]);
    else ctx.lineTo(x, data[i]);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.restore();
}

// ── Control panel component ──

interface ControlPanelProps {
  v1: number;
  v2: number;
  onV1Change: (v: number) => void;
  onV2Change: (v: number) => void;
  speedMultiplier: number;
  onSpeedMultiplierChange: (v: number) => void;
  direction: 'left' | 'right';
  onDirectionChange: (d: 'left' | 'right') => void;
  sourcePosition: 'left' | 'center' | 'right';
  onSourcePositionChange: (s: 'left' | 'center' | 'right') => void;
}

const controlBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  border: '1px solid #555',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: '"Times New Roman", serif',
};

const activeBtnStyle: React.CSSProperties = {
  ...controlBtnStyle,
  background: '#4a6fa5',
  color: '#fff',
  borderColor: '#4a6fa5',
};

const inactiveBtnStyle: React.CSSProperties = {
  ...controlBtnStyle,
  background: '#2a2a3e',
  color: '#aaa',
};

const sliderStyle: React.CSSProperties = {
  width: 100,
  accentColor: '#4a6fa5',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#aaa',
  fontFamily: '"Times New Roman", serif',
  marginRight: 4,
};

const groupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const ControlPanel: React.FC<ControlPanelProps> = ({
  v1, v2, onV1Change, onV2Change,
  speedMultiplier, onSpeedMultiplierChange,
  direction, onDirectionChange,
  sourcePosition, onSourcePositionChange,
}) => {
  return (
    <div
      style={{
        background: '#1e1e32',
        borderRadius: 6,
        border: '1px solid #333',
        padding: '10px 14px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 16,
        alignItems: 'center',
      }}
    >
      {/* Speed sliders */}
      <div style={groupStyle}>
        <span style={labelStyle}>v₁</span>
        <input
          type="range"
          min={0.1}
          max={6}
          step={0.1}
          value={v1}
          onChange={(e) => onV1Change(parseFloat(e.target.value))}
          style={sliderStyle}
        />
        <span style={{ ...labelStyle, minWidth: 32 }}>{v1.toFixed(1)}</span>
      </div>

      <div style={groupStyle}>
        <span style={labelStyle}>v₂</span>
        <input
          type="range"
          min={0.1}
          max={6}
          step={0.1}
          value={v2}
          onChange={(e) => onV2Change(parseFloat(e.target.value))}
          style={sliderStyle}
        />
        <span style={{ ...labelStyle, minWidth: 32 }}>{v2.toFixed(1)}</span>
      </div>

      {/* Speed multiplier */}
      <div style={groupStyle}>
        <span style={labelStyle}>倍速</span>
        {SPEED_PRESETS.map((val) => (
          <button
            key={val}
            onClick={() => onSpeedMultiplierChange(val)}
            style={speedMultiplier === val ? activeBtnStyle : inactiveBtnStyle}
          >
            {val}x
          </button>
        ))}
      </div>

      {/* Direction */}
      <div style={groupStyle}>
        <span style={labelStyle}>方向</span>
        <button
          onClick={() => onDirectionChange('left')}
          style={direction === 'left' ? activeBtnStyle : inactiveBtnStyle}
        >
          向左
        </button>
        <button
          onClick={() => onDirectionChange('right')}
          style={direction === 'right' ? activeBtnStyle : inactiveBtnStyle}
        >
          向右
        </button>
      </div>

      {/* Source position */}
      <div style={groupStyle}>
        <span style={labelStyle}>波源</span>
        <button
          onClick={() => onSourcePositionChange('left')}
          style={sourcePosition === 'left' ? activeBtnStyle : inactiveBtnStyle}
        >
          左边
        </button>
        <button
          onClick={() => onSourcePositionChange('center')}
          style={sourcePosition === 'center' ? activeBtnStyle : inactiveBtnStyle}
        >
          中间
        </button>
        <button
          onClick={() => onSourcePositionChange('right')}
          style={sourcePosition === 'right' ? activeBtnStyle : inactiveBtnStyle}
        >
          右边
        </button>
      </div>
    </div>
  );
};

// ── Main component ──

const WaveVisualization: React.FC<WaveVisualizationProps> = ({
  amplitude1 = 2,
  frequency1 = 1,
  wavelength1 = 4,
  amplitude2 = 2,
  frequency2 = 1,
  wavelength2 = 4,
  dualMedium = false,
  v1: v1Prop = 1,
  v2: v2Prop = 0.5,
  x1Boundary = 0.5,
  showParticles = false,
  width: _width = 700,
  speedMultiplier: speedMultProp = 1,
  direction: dirProp = 'right',
  sourcePosition: srcProp = 'center',
  renderControls = true,
}) => {
  // ── Internal control state (when renderControls is true) ──
  const [v1, setV1] = useState(v1Prop);
  const [v2, setV2] = useState(v2Prop);
  const [speedMult, setSpeedMult] = useState(speedMultProp);
  const [direction, setDirection] = useState<'left' | 'right'>(dirProp);
  const [sourcePos, setSourcePos] = useState<'left' | 'center' | 'right'>(srcProp);

  // Sync props → state when they change externally
  useEffect(() => { setV1(v1Prop); }, [v1Prop]);
  useEffect(() => { setV2(v2Prop); }, [v2Prop]);
  useEffect(() => { setSpeedMult(speedMultProp); }, [speedMultProp]);
  useEffect(() => { setDirection(dirProp); }, [dirProp]);
  useEffect(() => { setSourcePos(srcProp); }, [srcProp]);

  // ── Resolve effective values ──
  const effV1 = renderControls ? v1 : v1Prop;
  const effV2 = renderControls ? v2 : v2Prop;
  // 质点速度优化：倍速超过1x时对物理速度做对数压缩，避免太快失去教育意义
  // 1x→1, 2x→1.35, 4x→1.85, 8x→2.5
  const effSpeedRaw = renderControls ? speedMult : speedMultProp;
  const effSpeed = effSpeedRaw > 1 ? 1 + Math.log2(effSpeedRaw) * 0.2 : effSpeedRaw;
  const effDir = renderControls ? direction : dirProp;
  const effSrc = renderControls ? sourcePos : srcProp;

  // Source x-position
  const x0 = effSrc === 'left' ? 0 : effSrc === 'center' ? DISPLAY_LEN / 2 : DISPLAY_LEN;

  // ── Canvas refs ──
  const canvas1Ref = useRef<HTMLCanvasElement>(null);
  const canvas2Ref = useRef<HTMLCanvasElement>(null);
  const canvas3Ref = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  // ── Wave data generator ──
  const numSamples = 300;

  const makeWaveFn = useCallback(
    (A: number, λ: number, v: number): DrawWaveFn =>
      (_t: number) => {
        const data: number[] = new Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
          const xPhys = (i / (numSamples - 1)) * DISPLAY_LEN;
          data[i] = waveY(xPhys, x0, A, λ, v * effSpeed, _t, effDir);
        }
        return data;
      },
    [x0, effSpeed, effDir],
  );

  // ── Draw frame ──
  const drawFrame = useCallback(() => {
    const t = timeRef.current;

    const c1 = canvas1Ref.current;
    const c2 = canvas2Ref.current;
    const c3 = canvas3Ref.current;
    if (!c1 || !c2 || !c3) {
      animRef.current = requestAnimationFrame(drawFrame);
      return;
    }

    const ctx1 = c1.getContext('2d');
    const ctx2 = c2.getContext('2d');
    const ctx3 = c3.getContext('2d');
    if (!ctx1 || !ctx2 || !ctx3) {
      animRef.current = requestAnimationFrame(drawFrame);
      return;
    }

    // 动态计算 canvas 高度：基于当前振幅自适应
    const dynH = calcCanvasH(amplitude1, amplitude2);
    // 同步更新 DOM 尺寸（仅在变化时更新以节省性能）
    if (c1.height !== dynH * (window.devicePixelRatio || 1)) {
      const dpr = window.devicePixelRatio || 1;
      [c1, c2, c3].forEach(c => {
        c.width = CANVAS_W * dpr;
        c.height = dynH * dpr;
        c.style.width = `${CANVAS_W}px`;
        c.style.height = `${dynH}px`;
      });
    }

    // Wave 1
    const w1 = makeWaveFn(amplitude1, wavelength1, effV1);
    drawCanvas(ctx1, 'y₁', COLORS.wave1, amplitude1, w1, t, dynH);

    // Wave 2
    const w2 = makeWaveFn(amplitude2, wavelength2, effV2);
    drawCanvas(ctx2, 'y₂', COLORS.wave2, amplitude2, w2, t, dynH);

    // Combined (sum of both waves)
    const combinedAmp = amplitude1 + amplitude2;
    const w3: DrawWaveFn = (_t: number) => {
      const data: number[] = new Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        const u = i / (numSamples - 1);
        const xPhys = u * DISPLAY_LEN;
        const y1 = waveY(xPhys, x0, amplitude1, wavelength1, effV1 * effSpeed, _t, effDir);
        const y2 = waveY(xPhys, x0, amplitude2, wavelength2, effV2 * effSpeed, _t, effDir);
        data[i] = y1 + y2;
      }
      return data;
    };
    drawCanvas(ctx3, 'y合成', COLORS.combined, combinedAmp, w3, t, dynH);

    // Advance time
    timeRef.current += 0.016;
    animRef.current = requestAnimationFrame(drawFrame);
  }, [amplitude1, wavelength1, effV1, amplitude2, wavelength2, effV2, effSpeed, effDir, x0, makeWaveFn]);

  // ── Setup animation and resize ──
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const dynH = calcCanvasH(amplitude1, amplitude2);
    [canvas1Ref, canvas2Ref, canvas3Ref].forEach((ref) => {
      const c = ref.current;
      if (!c) return;
      c.width = CANVAS_W * dpr;
      c.height = dynH * dpr;
      c.style.width = `${CANVAS_W}px`;
      c.style.height = `${dynH}px`;
    });

    timeRef.current = 0;
    animRef.current = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(animRef.current);
  }, [drawFrame]);

  // ── Control handlers ──
  const handleV1Change = useCallback((v: number) => setV1(v), []);
  const handleV2Change = useCallback((v: number) => setV2(v), []);
  const handleSpeedMultChange = useCallback((v: number) => setSpeedMult(v), []);
  const handleDirChange = useCallback((d: 'left' | 'right') => setDirection(d), []);
  const handleSrcChange = useCallback((s: 'left' | 'center' | 'right') => setSourcePos(s), []);

  // ── Styles ──
  const canvasStyle: React.CSSProperties = {
    borderRadius: 6,
    border: '1px solid #333',
    display: 'block',
    flexShrink: 0,
  };

  const labelAboveStyle: React.CSSProperties = {
    fontSize: 11,
    color: '#888',
    fontFamily: '"Times New Roman", serif',
    textAlign: 'center',
    marginBottom: 2,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 'fit-content' }}>
      {/* Controls */}
      {renderControls && (
        <ControlPanel
          v1={v1}
          v2={v2}
          onV1Change={handleV1Change}
          onV2Change={handleV2Change}
          speedMultiplier={speedMult}
          onSpeedMultiplierChange={handleSpeedMultChange}
          direction={direction}
          onDirectionChange={handleDirChange}
          sourcePosition={sourcePos}
          onSourcePositionChange={handleSrcChange}
        />
      )}

      {/* Three canvases in a row */}
      <div style={{ display: 'flex', gap: 6, overflow: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={labelAboveStyle}>
            <i>y</i><sub>1</sub>
          </span>
          <canvas ref={canvas1Ref} style={canvasStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={labelAboveStyle}>
            <i>y</i><sub>2</sub>
          </span>
          <canvas ref={canvas2Ref} style={canvasStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={labelAboveStyle}>
            <i>y</i><sub>合成</sub>
          </span>
          <canvas ref={canvas3Ref} style={canvasStyle} />
        </div>
      </div>
    </div>
  );
};

export default WaveVisualization;
