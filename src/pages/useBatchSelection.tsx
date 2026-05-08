import React, { useRef, useCallback, useEffect, useState } from 'react';
import { message, Modal, Dropdown } from 'antd';
import { ScheduleStatus, Course } from '../types';
import dayjs, { Dayjs } from 'dayjs';

interface ScheduleEvent {
  id: string; course_id: string; course_name: string; course_type: any;
  start_time: string; end_time: string; status: ScheduleStatus; room?: string; notes?: string;
  course_year?: string; course_semester?: string;
}

const CW = 140; const SH = 2.5; const GAP = 8; const MIN_H = 8; const MAX_H = 23;

const slot = (h: number, m: number) => Math.floor(((h - MIN_H) * 60 + m) / 5);
const fmt = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

// 从鼠标事件获取 day/slot，同时检查 X 和 Y 坐标以区分两周行
function getDaySlotFromEvent(
  e: MouseEvent,
  containerEl: HTMLDivElement
): { day: number; slot: number } | null {
  const anchor = containerEl.querySelector('[data-anchor="true"]') as HTMLElement;
  if (!anchor) return null;
  const ar = anchor.getBoundingClientRect();
  const x = e.clientX - ar.left;
  const y = e.clientY;

  // 查找所有 day 列和它们的 rect
  const dayEls = containerEl.querySelectorAll('[data-date]');

  for (let i = 0; i < dayEls.length; i++) {
    const el = dayEls[i] as HTMLElement;
    const dr = el.getBoundingClientRect();
    const leftInContainer = dr.left - ar.left;
    const rightInContainer = dr.right - ar.left;

    // 同时检查 X 和 Y：鼠标必须在天列的水平范围内，且在天列的垂直范围内
    if (x >= leftInContainer && x <= rightInContainer && y >= dr.top && y <= dr.bottom) {
      const dateStr = el.getAttribute('data-date');
      if (dateStr) {
        const body = el.querySelector('[data-day-body="true"]') as HTMLElement;
        if (body) {
          const br = body.getBoundingClientRect();
          // 扣除paddingTop，使slot=0始终对应minHour（8:00）
          const computedStyle = window.getComputedStyle(body);
          const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
          const relY = e.clientY - br.top - paddingTop;
          const sl = Math.floor(relY / SH);
          return { day: i, slot: Math.max(0, sl) };
        }
      }
    }
  }

  return null;
}

export default function useBatchSelection(
  containerRef: React.RefObject<HTMLDivElement>,
  currentMonday: Dayjs,
  onSchedulesUpdated: (s: any[]) => void,
  onBatchDelete?: (ids: string[]) => void
) {
  const [phase, setPhase] = useState<'idle' | 'drawing' | 'selected' | 'dragging'>('idle');
  const [sel, setSel] = useState<{ ds: number; de: number; ss: number; se: number; ids: string[] } | null>(null);
  const [dragOff, setDragOff] = useState({ d: 0, s: 0 });
  const [isCopy, setIsCopy] = useState(false);
  const [oob, setOob] = useState(false);
  const [rb, setRb] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const [ghost, setGhost] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const [previews, setPreviews] = useState<any[]>([]);
  // 像素精确绘制矩形（鼠标跟随）
  const [drawRect, setDrawRect] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  // 批量删除确认框
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [flashingIds, setFlashingIds] = useState<string[]>([]);
  const [flashToggle, setFlashToggle] = useState(false);
  // 滚动位置计数器：滚动时强制重算矩形位置
  const [scrollTick, setScrollTick] = useState(0);

  // refs 避免闭包过期
  const phaseRef = useRef(phase);
  const selRef = useRef(sel);
  const oobRef = useRef(oob);
  const dragStartRef = useRef<{ d: number; s: number } | null>(null);
  const drawPixelStartRef = useRef<{ x: number; y: number } | null>(null);
  const rbRef = useRef<{ l: number; t: number; w: number; h: number } | null>(null);
  const schedRef = useRef<any[]>([]);
  const coursesRef = useRef<Course[]>([]);
  const twoWeeksRef = useRef<Dayjs[]>([]);
  const onUpdateRef = useRef(onSchedulesUpdated);

  // 同步 refs
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { selRef.current = sel; }, [sel]);
  useEffect(() => { oobRef.current = oob; }, [oob]);
  useEffect(() => { rbRef.current = rb; }, [rb]);
  useEffect(() => { onUpdateRef.current = onSchedulesUpdated; }, [onSchedulesUpdated]);

  // 滚动监听：容器滚动时重算矩形位置
  useEffect(() => {
    const c = containerRef.current;
    if (!c || phase === 'idle') return;
    const onScroll = () => setScrollTick(t => t + 1);
    c.addEventListener('scroll', onScroll, { passive: true });
    return () => c.removeEventListener('scroll', onScroll);
  }, [containerRef, phase]);

  // 当离开drawing/selected阶段时，清除精确绘制矩形和引用
  useEffect(() => {
    if (phase !== 'drawing' && phase !== 'selected') {
      setDrawRect(null);
      drawPixelStartRef.current = null;
    }
  }, [phase]);

  // 闪烁计时器：批量删除确认时交替边框颜色
  useEffect(() => {
    if (flashingIds.length === 0) { setFlashToggle(false); return; }
    const timer = setInterval(() => setFlashToggle(t => !t), 300);
    return () => clearInterval(timer);
  }, [flashingIds]);

  // 暴露更新函数+数据清理
  const setSchedules = useCallback((s: any[]) => {
    // 清理坏数据：修复时间 > 24:00 的课程
    schedRef.current = s.map((sc: any) => {
      if (!sc) return sc;
      let fixed = false;
      const fixTime = (t: string) => {
        const [datePart, timePart] = t.split(' ');
        const parts = timePart.split(':');
        let h = parseInt(parts[0]);
        if (h >= 24) {
          h = 23; fixed = true;
        } else if (h < 0) {
          h = 0; fixed = true;
        }
        return `${datePart} ${String(h).padStart(2, '0')}:${parts[1]}`;
      };
      if (sc.start_time) {
        const [, tp] = sc.start_time.split(' ');
        if (tp && parseInt(tp) > 24) { sc.start_time = fixTime(sc.start_time); }
      }
      if (sc.end_time) {
        const [, tp] = sc.end_time.split(' ');
        if (tp && parseInt(tp) > 24) { sc.end_time = fixTime(sc.end_time); }
      }
      return sc;
    });
  }, []);
  const setCourses = useCallback((c: Course[]) => { coursesRef.current = c; }, []);

  // 获取目标day列在container中的实际位置（跨周换行正确）
  // 返回容器相对坐标（用于 position:absolute）
  function getTargetDayPosition(targetDayIdx: number, container: HTMLElement): { left: number; bodyTop: number } | null {
    if (!twoWeeksRef.current[targetDayIdx]) return null;
    const targetDate = twoWeeksRef.current[targetDayIdx];
    const dateStr = targetDate.format('YYYY-MM-DD');
    const dayEl = container.querySelector(`[data-date="${dateStr}"]`) as HTMLElement;
    if (!dayEl) return null;
    const anchor = container.querySelector('[data-anchor="true"]') as HTMLElement;
    if (!anchor) return null;
    const ar = anchor.getBoundingClientRect();
    const dr = dayEl.getBoundingClientRect();
    const body = dayEl.querySelector('[data-day-body="true"]') as HTMLElement;
    const bodyTop = body ? body.getBoundingClientRect().top - ar.top : 0;
    return { left: dr.left - ar.left, bodyTop };
  }

  // 计算两周日期
  useEffect(() => {
    const days: Dayjs[] = [];
    for (let i = 0; i < 14; i++) days.push(currentMonday.add(i, 'day'));
    twoWeeksRef.current = days;
  }, [currentMonday]);

  // 更新矩形像素位置（容器相对坐标，用于 position:absolute）
  // 注意：position:absolute 相对于 containerRef 且 containerRef 有 overflow/scroll，
  // 因此使用 getBoundingClientRect 的差值（视口坐标差）不需要加 scrollLeft/scrollTop，
  // 因为 absolute 定位已经相对于容器本身的第一帧位置。
  useEffect(() => {
    if (!sel || !containerRef.current) { setRb(null); return; }
    const c = containerRef.current;
    const anchor = c.querySelector('[data-anchor="true"]') as HTMLElement;
    if (!anchor) { setRb(null); return; }
    const ar = anchor.getBoundingClientRect();
    const dayEls = c.querySelectorAll('[data-date]');
    let l = 0, r = 0;

    // 找到 dayStart 列的 body top
    let bodyTopOff = 0;
    for (let i = 0; i < dayEls.length; i++) {
      const el = dayEls[i] as HTMLElement;
      const dateStr = el.getAttribute('data-date');
      if (!dateStr) continue;
      const idx = twoWeeksRef.current.findIndex(d => d.format('YYYY-MM-DD') === dateStr);
      if (idx === sel.ds) {
        const dr = el.getBoundingClientRect();
        l = dr.left - ar.left;
        const body = el.querySelector('[data-day-body="true"]') as HTMLElement;
        if (body) bodyTopOff = body.getBoundingClientRect().top - ar.top;
      }
      if (idx === sel.de) {
        const dr = el.getBoundingClientRect();
        r = dr.right - ar.left;
      }
    }

    setRb({
      l,
      t: bodyTopOff + sel.ss * SH,
      w: r - l,
      h: (sel.se - sel.ss + 1) * SH,
    });
  }, [sel, containerRef, scrollTick]);

  // 搞影位置（跨周换行修正）
  useEffect(() => {
    if (!rb || phase !== 'dragging' || !sel) { setGhost(null); return; }
    const container = containerRef.current;
    if (!container) { setGhost(null); return; }
    // 获取目标起始日期的实际DOM位置
    const targetDayIdx = sel.ds + dragOff.d;
    const targetPos = getTargetDayPosition(targetDayIdx, container);
    if (targetPos) {
      // getTargetDayPosition 已返回容器相对坐标
      setGhost({
        l: targetPos.left,
        t: targetPos.bodyTop + (sel.ss + dragOff.s) * SH,
        w: rb.w,
        h: rb.h,
      });
    } else {
      // 回退：线性计算
      setGhost({
        l: rb.l + dragOff.d * (CW + GAP),
        t: rb.t + dragOff.s * SH,
        w: rb.w,
        h: rb.h,
      });
    }
  }, [rb, phase, dragOff, sel, containerRef, scrollTick]);

  // 更新预览（跨周换行修正位置）
  useEffect(() => {
    if (phase !== 'dragging' || !sel) { setPreviews([]); return; }
    const ds = dragOff.s;
    const dd = dragOff.d;
    const container = containerRef.current;
    console.log('[BatchDrag] 预览计算: dd=', dd, 'ds=', ds, 'sel=', JSON.stringify({ds:sel.ds,de:sel.de,ss:sel.ss,se:sel.se,ids:sel.ids.length}));
    const pv = sel.ids.map(cid => {
      const s = schedRef.current.find((x: any) => x.id === cid);
      if (!s) return null;
      const [date, st] = s.start_time.split(' ');
      const ep = s.end_time.split(' ');
      const et = ep.length >= 2 ? ep[1] : ep[0];
      const [sh, sm] = st.split(':').map(Number);
      const [eh, em] = et.split(':').map(Number);
      const od = twoWeeksRef.current.findIndex(d => d.format('YYYY-MM-DD') === date);
      const origStartSlot = slot(sh, sm);
      const origEndSlot = slot(eh, em);
      const newStartSlot = origStartSlot + ds;
      const newEndSlot = origEndSlot + ds;
      const totalStartMins = newStartSlot * 5;
      const totalEndMins = newEndSlot * 5;
      const nsh = MIN_H + Math.floor(totalStartMins / 60);
      const nsm = ((totalStartMins % 60) + 60) % 60;
      const neh = MIN_H + Math.floor(totalEndMins / 60);
      const nem = ((totalEndMins % 60) + 60) % 60;

      // 计算目标day的实际DOM位置（支持跨周换行）
      let absLeft = (od - sel.ds) * (CW + GAP) + 4; // fallback
      let absTop = (origStartSlot - sel.ss) * SH;
      if (container) {
        const targetDayIdx = od + dd;
        const tPos = getTargetDayPosition(targetDayIdx, container);
        // 获取矩形框起始列的目标位置（作为参考锚点）
        const anchorDayIdx = sel.ds + dd;
        const anchorPos = getTargetDayPosition(anchorDayIdx, container);
        if (tPos && anchorPos) {
          // 预览框相对于ghost容器的位置
          //   left: 课程所在目标列left - ghost容器left + 4px内边距
          absLeft = tPos.left - anchorPos.left + 4;
          //   top: 课程所在行bodyTop + 课程时间偏移 - 矩形框起始bodyTop - 矩形框时间偏移
          //        = (origStartSlot - sel.ss) * SH + (tPos.bodyTop - anchorPos.bodyTop)
          absTop = (origStartSlot - sel.ss) * SH + (tPos.bodyTop - anchorPos.bodyTop);
        }
      }
      console.log('[BatchDrag] 课程:', s.course_name||cid, '原时间=',fmt(sh,sm)+'-'+fmt(eh,em),
        'origSlot=',origStartSlot, 'ds=',ds, 'newSlot=',newStartSlot, '新时间=',fmt(nsh,nsm)+'-'+fmt(neh,nem));
      return {
        id: cid,
        rd: od - sel.ds,
        rt: absTop,
        rh: Math.max(20, (origEndSlot - origStartSlot) * SH),
        left: absLeft,
        name: s.course_name || coursesRef.current.find(c => c.id === s.course_id)?.name || '课',
        room: s.room || coursesRef.current.find(c => c.id === s.course_id)?.room_name || '',
        sh: nsh, sm: nsm, eh: neh, em: nem,
      };
    }).filter(Boolean);
    setPreviews(pv);
  }, [phase, sel, dragOff, ghost, containerRef]);

  // 核心：矩形内的课程
  const getCoursesInRect = useCallback((ds: number, de: number, ss: number, se: number): string[] => {
    const ids: string[] = [];
    schedRef.current.forEach((s: any) => {
      if (s.status !== ScheduleStatus.PLANNED) return;
      const [date, st] = s.start_time.split(' ');
      const ep = s.end_time.split(' ');
      const et = ep.length >= 2 ? ep[1] : ep[0];
      if (!et) return;
      const [sh, sm] = st.split(':').map(Number);
      const [eh, em] = et.split(':').map(Number);
      const cd = twoWeeksRef.current.findIndex(d => d.format('YYYY-MM-DD') === date);
      if (cd >= ds && cd <= de && slot(eh, em) >= ss && slot(sh, sm) <= se) {
        ids.push(s.id);
      }
    });
    return ids;
  }, []);

  // 判断鼠标是否在课程卡片上
  const isOnCard = useCallback((e: MouseEvent): boolean => {
    const t = e.target as HTMLElement;
    // 检测课程卡片（data-course-card）或拖拽课程卡片
    return !!(t.closest('[data-course-card="true"]') || t.closest('[draggable="true"]'));
  }, []);

  // 事件处理器
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onDown = (e: MouseEvent) => {
      // 右键：选中状态下，在矩形框内让 Dropdown 接管菜单，在矩形框外取消选中
      if (e.button === 2) {
        if (phaseRef.current === 'selected' && rbRef.current) {
          const mx = e.clientX;
          const my = e.clientY;
          const r = rbRef.current;
          // 检查右键位置是否在矩形框范围内
          if (mx >= r.l && mx <= r.l + r.w && my >= r.t && my <= r.t + r.h) {
            return; // 在矩形框内 → 让 Dropdown 接管
          }
        }
        // 矩形框外右键 → 取消选中
        if (phaseRef.current !== 'idle') {
          setPhase('idle'); setSel(null); setDrawRect(null); drawPixelStartRef.current = null;
        }
        return;
      }
      if (e.button !== 0) return;

      const pos = getDaySlotFromEvent(e, el);
      if (!pos) return;

      const currentPhase = phaseRef.current;
      const currentSel = selRef.current;

      // 优先处理矩形区域内的点击：点击在已选中的矩形内，不管是不是在课程卡片上，都进入批量拖拽
      if (currentPhase === 'selected' && currentSel) {
        const inR = pos.day >= currentSel.ds && pos.day <= currentSel.de &&
                    pos.slot >= currentSel.ss && pos.slot <= currentSel.se;
        if (inR) {
          setPhase('dragging');
          setIsCopy(e.ctrlKey || e.metaKey);
          dragStartRef.current = { d: pos.day, s: pos.slot };
          setDragOff({ d: 0, s: 0 });
          console.log('[BatchDrag] 开始拖拽: clickDay=', pos.day, 'clickSlot=', pos.slot, 'sel=', JSON.stringify({ds:currentSel.ds,de:currentSel.de,ss:currentSel.ss,se:currentSel.se}));
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      // 不在矩形内，且点击在课程卡片上？交给 DailyView 处理单个课程拖拽
      if (isOnCard(e)) return;

      // 选中状态下点击矩形外：先解锁，不立即开始新矩形（下次点击再画）
      if (currentPhase === 'selected') {
        setPhase('idle');
        setSel(null);
        setDrawRect(null);
        drawPixelStartRef.current = null;
        e.preventDefault();
        return;
      }

      // 开始新矩形（记录鼠标精确像素位置）
      setSel(null);
      setPhase('drawing');
      setDrawRect(null);
      dragStartRef.current = { d: pos.day, s: pos.slot };
      const anchorEl = el.querySelector('[data-anchor="true"]') as HTMLElement;
      if (!anchorEl) return;
      const ar = anchorEl.getBoundingClientRect();
      drawPixelStartRef.current = { x: e.clientX - ar.left, y: e.clientY - ar.top };
      e.preventDefault();
    };

    const onMove = (e: MouseEvent) => {
      const pos = getDaySlotFromEvent(e, el);
      if (!pos) return;

      const currentPhase = phaseRef.current;

      if (currentPhase === 'drawing') {
        const ds = Math.min(dragStartRef.current!.d, pos.day);
        const de = Math.max(dragStartRef.current!.d, pos.day);
        const ss = Math.min(dragStartRef.current!.s, pos.slot);
        const se = Math.max(dragStartRef.current!.s, pos.slot);
        const ids = getCoursesInRect(ds, de, ss, se);
        setSel({ ds, de, ss, se, ids });

        // 像素精确绘制矩形：跟随鼠标位置（容器相对坐标，用于 position:absolute）
        const sp = drawPixelStartRef.current;
        if (sp) {
          const c = containerRef.current;
          if (c) {
            const anchorEl = c.querySelector('[data-anchor="true"]') as HTMLElement;
            if (!anchorEl) return;
            const ar = anchorEl.getBoundingClientRect();
            const mx = e.clientX - ar.left;
            const my = e.clientY - ar.top;
            const l = Math.min(sp.x, mx);
            const t = Math.min(sp.y, my);
            const r = Math.max(sp.x, mx);
            const b = Math.max(sp.y, my);
            setDrawRect({ l, t, w: r - l, h: b - t });
          }
        }
      } else if (currentPhase === 'dragging') {
        const dd = pos.day - dragStartRef.current!.d;
        const dss = pos.slot - dragStartRef.current!.s;
        console.log('[BatchDrag] onMove: pos.day=', pos.day, 'pos.slot=', pos.slot, 'startDay=', dragStartRef.current!.d, 'startSlot=', dragStartRef.current!.s, 'dd=', dd, 'dss=', dss);
        setDragOff({ d: dd, s: dss });

        const currentSel = selRef.current;
        if (currentSel) {
          // ② 逐课程检查OOB，三条规则：
          //   1. 开始时间<0:00 或 结束时间>24:00 → 超限
          //   2. 课程移动后横跨两周 → 超限
          //   3. 矩形框左右边界超出课程表 → 超限
          const minSlot = slot(0, 0);   // 0:00 对应的 slot = -96
          const maxSlot = slot(24, 0);  // 24:00 对应的 slot = 192
          let anyOob = false;
          let weekSet = new Set<number>(); // 记录课程移动后所在的周
          // 规则3：矩形框左右边界
          const nds = currentSel.ds + dd;
          const nde = currentSel.de + dd;
          if (nds < 0 || nde > 13) anyOob = true;

          currentSel.ids.forEach(cid => {
            if (anyOob) return; // 已超限则跳过
            const s = schedRef.current.find((x: any) => x.id === cid);
            if (!s) return;
            const [date, st] = s.start_time.split(' ');
            const ep = s.end_time.split(' ');
            const et = ep.length >= 2 ? ep[1] : ep[0];
            const [sh, sm] = st.split(':').map(Number);
            const [eh, em] = et.split(':').map(Number);
            const od = twoWeeksRef.current.findIndex(d => d.format('YYYY-MM-DD') === date);
            if (od < 0) return;
            const nd = od + dd;
            const os = slot(sh, sm);
            const oe = slot(eh, em);
            const ns = os + dss;
            const ne = oe + dss;
            // 规则1：时间超限（开始<0:00，结束>24:00）
            if (ns < minSlot || ne > maxSlot) anyOob = true;
            // 规则2：记录课程所在周（day0-6→第1周，day7-13→第2周）
            if (nd >= 0 && nd <= 13) {
              weekSet.add(nd < 7 ? 1 : 2);
            }
          });
          // 规则2：课程横跨两周则超限
          if (weekSet.size > 1) anyOob = true;

          setOob(anyOob);
        }
      }
    };

    const onUp = (e: MouseEvent) => {
      const pos = getDaySlotFromEvent(e, el);
      const currentPhase = phaseRef.current;

      if (currentPhase === 'drawing') {
        const currentSel = selRef.current;
        if (currentSel && currentSel.ids.length > 0) {
          setPhase('selected');
          // Step 1: 先将rb设为像素精确的drawRect位置
          const sp = drawPixelStartRef.current;
          if (sp && containerRef.current) {
            const anchorEl = containerRef.current.querySelector('[data-anchor="true"]') as HTMLElement;
            if (!anchorEl) return;
            const ar = anchorEl.getBoundingClientRect();
            const cx = e.clientX - ar.left;
            const cy = e.clientY - ar.top;
            const l = Math.min(sp.x, cx);
            const t = Math.min(sp.y, cy);
            const r = Math.max(sp.x, cx);
            const b = Math.max(sp.y, cy);
            setRb({ l, t, w: r - l, h: b - t });
            // Step 2: 下一帧过渡到列对齐位置（让CSS transition动画生效）
            requestAnimationFrame(() => {
              if (!containerRef.current || !selRef.current) return;
              const c = containerRef.current;
              const anchorEl = c.querySelector('[data-anchor="true"]') as HTMLElement;
              if (!anchorEl) return;
              const ar = anchorEl.getBoundingClientRect();
              const dayEls = c.querySelectorAll('[data-date]');
              let nl = 0, nr = 0;
              let bodyTopOff2 = 0;
              for (let i = 0; i < dayEls.length; i++) {
                const dayEl = dayEls[i] as HTMLElement;
                const ds = dayEl.getAttribute('data-date');
                if (!ds) continue;
                const idx = twoWeeksRef.current.findIndex(d => d.format('YYYY-MM-DD') === ds);
                if (idx === selRef.current.ds) {
                  const dr = dayEl.getBoundingClientRect();
                  nl = dr.left - ar.left;
                  const body = dayEl.querySelector('[data-day-body="true"]') as HTMLElement;
                  if (body) bodyTopOff2 = body.getBoundingClientRect().top - ar.top;
                }
                if (idx === selRef.current.de) {
                  const dr = dayEl.getBoundingClientRect();
                  nr = dr.right - ar.left;
                }
              }
              setRb({ l: nl, t: bodyTopOff2 + selRef.current.ss * SH, w: nr - nl, h: (selRef.current.se - selRef.current.ss + 1) * SH });
            });
          }
        } else {
          setPhase('idle');
          setSel(null);
        }
      } else if (currentPhase === 'dragging') {
        const currentSel = selRef.current;
        if (currentSel && dragStartRef.current && pos) {
          const dd = pos.day - dragStartRef.current.d;
          const dss = pos.slot - dragStartRef.current.s;

          if ((dd === 0 && dss === 0) || oobRef.current) {
            setPhase('selected');
            setDragOff({ d: 0, s: 0 });
            return;
          }

          // 3）独立的 OnUp OOB 双重验证：防止闭包过期导致坏数据被写入
          const minSlot = slot(0, 0);   // 0:00 对应的 slot = -96
          const maxSlot = slot(24, 0);  // 24:00 对应的 slot = 192
          let hasOobOnUp = false;

          const newS = [...schedRef.current];
          currentSel.ids.forEach(cid => {
            if (hasOobOnUp) return;
            const s = schedRef.current.find((x: any) => x.id === cid);
            if (!s) return;
            const [od, ost] = s.start_time.split(' ');
            const ep = s.end_time.split(' ');
            const oet = ep.length >= 2 ? ep[1] : ep[0];
            const [sh_, sm_] = ost.split(':').map(Number);
            const [eh_, em_] = oet.split(':').map(Number);
            const os = slot(sh_, sm_);
            const oe = slot(eh_, em_);
            const ns = os + dss;
            const ne = oe + dss;
            if (ns < minSlot || ne > maxSlot) {
              hasOobOnUp = true;
            }
          });
          if (hasOobOnUp) {
            setPhase('selected');
            setDragOff({ d: 0, s: 0 });
            return;
          }
          currentSel.ids.forEach(cid => {
            const s = schedRef.current.find((x: any) => x.id === cid);
            if (!s) return;
            const [od, ost] = s.start_time.split(' ');
            const ep = s.end_time.split(' ');
            const oet = ep.length >= 2 ? ep[1] : ep[0];
            const [sh_, sm_] = ost.split(':').map(Number);
            const [eh_, em_] = oet.split(':').map(Number);
            const od_ = twoWeeksRef.current.findIndex(d => d.format('YYYY-MM-DD') === od);
            const os = slot(sh_, sm_);
            const dur = slot(eh_, em_) - os;
            const nd_ = od_ + dd;
            const ns = os + dss;
            const ne = ns + dur;
            // ① 天数边界：0~13（两周范围）
            if (nd_ < 0 || nd_ > 13) return;
            const nd = twoWeeksRef.current[0].add(nd_, 'day');
            // ① 统一使用与预览相同的时间计算，处理负数取模
            const totalStartMins = ns * 5;
            const totalEndMins = ne * 5;
            const nsh = MIN_H + Math.floor(totalStartMins / 60);
            const nsm = ((totalStartMins % 60) + 60) % 60;
            const neh = MIN_H + Math.floor(totalEndMins / 60);
            const nem = ((totalEndMins % 60) + 60) % 60;

            if (isCopy) {
              newS.push({
                ...s,
                id: s.id + '_cpy_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                start_time: `${nd.format('YYYY-MM-DD')} ${fmt(nsh, nsm)}`,
                end_time: `${nd.format('YYYY-MM-DD')} ${fmt(neh, nem)}`,
              });
            } else {
              const idx = newS.findIndex((x: any) => x.id === cid);
              if (idx >= 0) {
                newS[idx] = {
                  ...s,
                  start_time: `${nd.format('YYYY-MM-DD')} ${fmt(nsh, nsm)}`,
                  end_time: `${nd.format('YYYY-MM-DD')} ${fmt(neh, nem)}`,
                };
              }
            }
          });

          // ④ 时间冲突检测：批量操作松开后检查所有移动/复制课程的时间重叠
          const checkSchedules = newS.filter((x: any) => {
            // 仅检查被操作过的课程（移动的原始课 或 新复制的课）
            if (!x) return false;
            if (isCopy) {
              return x.id.includes('_cpy_');
            }
            return currentSel.ids.includes(x.id) || x.id.includes('_cpy_');
          });
          let conflictFound: string | null = null;
          for (const checkItem of checkSchedules) {
            if (conflictFound) break;
            for (const other of newS) {
              if (other.id === checkItem.id) continue;
              // 跳过取消/请假状态（它们不占时间槽）
              if (other.status === ScheduleStatus.CANCELLED || other.status === ScheduleStatus.LEAVE) continue;
              if (other.status === ScheduleStatus.COMPLETED) continue;
              if (checkItem.start_time < other.end_time && checkItem.end_time > other.start_time) {
                conflictFound = other.course_name || '其他课程';
                break;
              }
            }
          }
          if (conflictFound) {
            message.warning(`时间冲突：与「${conflictFound}」时间段重叠，批量操作已撤销`);
            setPhase('idle');
            setSel(null);
            setDragOff({ d: 0, s: 0 });
            return;
          }

          onUpdateRef.current(newS);
          schedRef.current = newS;
        }
        setPhase('idle');
        setSel(null);
        setDragOff({ d: 0, s: 0 });
      }
    };

    const onCtx = (e: MouseEvent) => {
      const isInRb = phaseRef.current === 'selected' && rbRef.current && (() => {
        const mx = e.clientX;
        const my = e.clientY;
        const r = rbRef.current!;
        return mx >= r.l && mx <= r.l + r.w && my >= r.t && my <= r.t + r.h;
      })();
      if (isInRb) {
        // 矩形框内右键 → 阻止浏览器菜单，让 Dropdown 接管
        e.preventDefault();
        return;
      }
      if (phaseRef.current !== 'idle') {
        e.preventDefault();
        setPhase('idle');
        setSel(null);
      }
    };

    el.addEventListener('mousedown', onDown);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseup', onUp);
    el.addEventListener('contextmenu', onCtx);

    return () => {
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseup', onUp);
      el.removeEventListener('contextmenu', onCtx);
    };
  }, [containerRef, isOnCard, getCoursesInRect, isCopy, oob]);

  return {
    phase,
    selectedCourseIds: sel?.ids || [],
    isCopy,
    batchVisuals: phase === 'idle' ? null : (
      <>
        {/* 绘制中：像素精确矩形跟随鼠标（容器相对坐标，position:absolute） */}
        {phase === 'drawing' && drawRect && (
          <div style={{ position: 'absolute', left: drawRect.l, top: drawRect.t, width: drawRect.w, height: Math.max(20, drawRect.h), border: '2px dashed #1890ff', background: 'rgba(24,144,255,0.06)', borderRadius: 4, zIndex: 101, pointerEvents: 'none' }} />
        )}
        {/* 选中后：柱状对齐矩形带过渡动画 + 右键菜单（位置:absolute 相对容器，随滚动移动） */}
        {phase === 'selected' && rb && (
          <Dropdown
            trigger={['contextMenu']}
            menu={{
              items: [
                {
                  key: 'batch-delete',
                  label: '🗑️ 全部删除',
                  danger: true,
                  onClick: () => {
                    if (!sel || sel.ids.length === 0) return;
                    setFlashingIds(sel.ids);
                    setDeleteConfirmVisible(true);
                  }
                }
              ]
            }}
          >
            <div style={{ position: 'absolute', left: rb.l, top: rb.t, width: rb.w, height: Math.max(20, rb.h), border: '2px dashed #1890ff', background: 'rgba(24,144,255,0.10)', borderRadius: 4, zIndex: 101, cursor: 'default' }}>
              {sel && (
                <div style={{ position: 'absolute', top: -24, left: 4, background: '#1890ff', color: '#fff', padding: '1px 8px', borderRadius: 10, fontSize: 11, whiteSpace: 'nowrap' }}>
                  已选 {sel.ids.length} 课 · 拖拽移动 · Ctrl+拖拽复制 · 右键更多
                </div>
              )}
            </div>
          </Dropdown>
        )}
        {phase === 'dragging' && ghost && (
          <div style={{ position: 'absolute', left: ghost.l, top: ghost.t, width: ghost.w, height: ghost.h, border: '2px dashed #faad14', background: 'rgba(250,173,20,0.12)', borderRadius: 4, zIndex: 102, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: oob ? -28 : -24, left: 4, background: oob ? '#ff4d4f' : '#faad14', color: '#fff', padding: '1px 8px', borderRadius: 10, fontSize: 11, whiteSpace: 'nowrap', fontWeight: oob ? 'bold' : 'normal' }}>
              {oob ? '⚠️ 超出范围' : `${isCopy ? '复制中' : '移动中'} · 松开确认`}
            </div>
            {previews.map((p: any) => (
              <div key={p.id} style={{ position: 'absolute', left: p.left ?? (p.rd * (CW + GAP) + 4), top: p.rt, width: CW - 8, height: p.rh, background: isCopy ? 'rgba(82,196,26,0.25)' : 'rgba(24,144,255,0.25)', border: isCopy ? '2px dashed #52c41a' : '2px dashed #1890ff', borderRadius: 6, padding: 2, fontSize: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', boxShadow: isCopy ? '0 4px 20px rgba(82,196,26,0.3)' : '0 4px 20px rgba(24,144,255,0.3)' }}>
                <div style={{ fontWeight: 'bold', lineHeight: 1.2, color: isCopy ? '#52c41a' : '#1890ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: CW - 16, textAlign: 'center' }}>{isCopy ? '📋 ' : ''}{p.name}</div>
                <div style={{ fontSize: 10, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: CW - 16, textAlign: 'center', marginTop: 2 }}>
                  {p.room && <span>{p.room} </span>}
                  <span style={{ color: '#ff4d4f', fontWeight: 'bold', background: 'rgba(255,77,79,0.15)', padding: '0 2px', borderRadius: 2 }}>{fmt(p.sh, p.sm)}</span>
                  <span style={{ color: '#666' }}>-</span>
                  <span style={{ color: '#ff4d4f', fontWeight: 'bold', background: 'rgba(255,77,79,0.15)', padding: '0 2px', borderRadius: 2 }}>{fmt(p.eh, p.em)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* 批量删除确认框 */}
        <Modal
          open={deleteConfirmVisible}
          title="确认批量删除"
          okText="确认删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onCancel={() => { setDeleteConfirmVisible(false); setFlashingIds([]); }}
          onOk={() => {
            if (flashingIds.length > 0) {
              if (onBatchDelete) {
                onBatchDelete(flashingIds);
              } else {
                // 默认从 schedRef 中删除
                const newS = schedRef.current.filter((s: any) => !flashingIds.includes(s.id));
                schedRef.current = newS;
                onUpdateRef.current(newS);
              }
            }
            setDeleteConfirmVisible(false);
            setFlashingIds([]);
            setPhase('idle');
            setSel(null);
          }}
        >
          <p>确定要删除选中的 <b style={{ color: '#ff4d4f' }}>{flashingIds.length}</b> 节课程吗？</p>
        </Modal>
        {/* 闪烁高亮动画样式 - 仅定义keyframes，由inline animation属性触发 */}
        {flashingIds.length > 0 && (
          <style>{`
            @keyframes batchFlash {
              0%, 100% { border-color: #ff4d4f; box-shadow: 0 0 8px rgba(255,77,79,0.6); }
              50% { border-color: #faad14; box-shadow: 0 0 8px rgba(250,173,20,0.6); }
            }
          `}</style>
        )}
      </>
    ),
    flashingIds,
    flashToggle,
    setSchedules,
    setCourses
  };
}
