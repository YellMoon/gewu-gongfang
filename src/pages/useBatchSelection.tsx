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

// 浠庨紶鏍囦簨浠惰幏鍙?day/slot锛屽悓鏃舵鏌?X 鍜?Y 鍧愭爣浠ュ尯鍒嗕袱鍛ㄨ
function getDaySlotFromEvent(
  e: MouseEvent,
  containerEl: HTMLDivElement
): { day: number; slot: number } | null {
  const anchor = containerEl.querySelector('[data-anchor="true"]') as HTMLElement;
  if (!anchor) return null;
  const ar = anchor.getBoundingClientRect();
  const x = e.clientX - ar.left;
  const y = e.clientY;

  // 鏌ユ壘鎵€鏈?day 鍒楀拰瀹冧滑鐨?rect
  const dayEls = containerEl.querySelectorAll('[data-date]');

  for (let i = 0; i < dayEls.length; i++) {
    const el = dayEls[i] as HTMLElement;
    const dr = el.getBoundingClientRect();
    const leftInContainer = dr.left - ar.left;
    const rightInContainer = dr.right - ar.left;

    if (x >= leftInContainer && x <= rightInContainer && y >= dr.top && y <= dr.bottom) {
      const dateStr = el.getAttribute('data-date');
      if (dateStr) {
        const body = el.querySelector('[data-day-body="true"]') as HTMLElement;
        if (body) {
          const br = body.getBoundingClientRect();
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
  onBatchDelete: (ids: string[]) => void
) {
  const [phase, setPhase] = useState<'idle' | 'drawing' | 'selected' | 'dragging'>('idle');
  const [sel, setSel] = useState<{ ds: number; de: number; ss: number; se: number; ids: string[] } | null>(null);
  const [dragOff, setDragOff] = useState({ d: 0, s: 0 });
  const [isCopy, setIsCopy] = useState(false);
  const [oob, setOob] = useState(false);
  const [rb, setRb] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const [ghost, setGhost] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const [previews, setPreviews] = useState<any[]>([]);
  // 鍍忕礌绮剧‘缁樺埗鐭╁舰锛堥紶鏍囪窡闅忥級
  const [drawRect, setDrawRect] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [flashingIds, setFlashingIds] = useState<string[]>([]);
  const [flashToggle, setFlashToggle] = useState(false);
  const [scrollTick, setScrollTick] = useState(0);

  // refs 閬垮厤闂寘杩囨湡
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

  // 鍚屾 refs
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { selRef.current = sel; }, [sel]);
  useEffect(() => { oobRef.current = oob; }, [oob]);
  useEffect(() => { rbRef.current = rb; }, [rb]);
  useEffect(() => { onUpdateRef.current = onSchedulesUpdated; }, [onSchedulesUpdated]);

  // 婊氬姩鐩戝惉锛氬鍣ㄦ粴鍔ㄦ椂閲嶇畻鐭╁舰浣嶇疆
  useEffect(() => {
    const c = containerRef.current;
    if (!c || phase === 'idle') return;
    const onScroll = () => setScrollTick(t => t + 1);
    c.addEventListener('scroll', onScroll, { passive: true });
    return () => c.removeEventListener('scroll', onScroll);
  }, [containerRef, phase]);

  useEffect(() => {
    if (phase !== 'drawing' && phase !== 'selected') {
      setDrawRect(null);
      drawPixelStartRef.current = null;
    }
  }, [phase]);

  useEffect(() => {
    if (flashingIds.length === 0) { setFlashToggle(false); return; }
    const timer = setInterval(() => setFlashToggle(t => !t), 300);
    return () => clearInterval(timer);
  }, [flashingIds]);

  // 鏆撮湶鏇存柊鍑芥暟+鏁版嵁娓呯悊
  const setSchedules = useCallback((s: any[]) => {
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

  // 鑾峰彇鐩爣day鍒楀湪container涓殑瀹為檯浣嶇疆锛堣法鍛ㄦ崲琛屾纭級
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

  // 璁＄畻涓ゅ懆鏃ユ湡
  useEffect(() => {
    const days: Dayjs[] = [];
    for (let i = 0; i < 14; i++) days.push(currentMonday.add(i, 'day'));
    twoWeeksRef.current = days;
  }, [currentMonday]);

  useEffect(() => {
    if (!sel || !containerRef.current) { setRb(null); return; }
    const c = containerRef.current;
    const anchor = c.querySelector('[data-anchor="true"]') as HTMLElement;
    if (!anchor) { setRb(null); return; }
    const ar = anchor.getBoundingClientRect();
    const dayEls = c.querySelectorAll('[data-date]');
    let l = 0, r = 0;

    // 鎵惧埌 dayStart 鍒楃殑 body top
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

  // 鎼炲奖浣嶇疆锛堣法鍛ㄦ崲琛屼慨姝ｏ級
  useEffect(() => {
    if (!rb || phase !== 'dragging' || !sel) { setGhost(null); return; }
    const container = containerRef.current;
    if (!container) { setGhost(null); return; }
    // 鑾峰彇鐩爣璧峰鏃ユ湡鐨勫疄闄匘OM浣嶇疆
    const targetDayIdx = sel.ds + dragOff.d;
    const targetPos = getTargetDayPosition(targetDayIdx, container);
    if (targetPos) {
      setGhost({
        l: targetPos.left,
        t: targetPos.bodyTop + (sel.ss + dragOff.s) * SH,
        w: rb.w,
        h: rb.h,
      });
    } else {
      setGhost({
        l: rb.l + dragOff.d * (CW + GAP),
        t: rb.t + dragOff.s * SH,
        w: rb.w,
        h: rb.h,
      });
    }
  }, [rb, phase, dragOff, sel, containerRef, scrollTick]);

  // 鏇存柊棰勮锛堣法鍛ㄦ崲琛屼慨姝ｄ綅缃級
  useEffect(() => {
    if (phase !== 'dragging' || !sel) { setPreviews([]); return; }
    const ds = dragOff.s;
    const dd = dragOff.d;
    const container = containerRef.current;
    console.log('[BatchDrag] 棰勮璁＄畻: dd=', dd, 'ds=', ds, 'sel=', JSON.stringify({ds:sel.ds,de:sel.de,ss:sel.ss,se:sel.se,ids:sel.ids.length}));
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

      // 璁＄畻鐩爣day鐨勫疄闄匘OM浣嶇疆锛堟敮鎸佽法鍛ㄦ崲琛岋級
      let absLeft = (od - sel.ds) * (CW + GAP) + 4; // fallback
      let absTop = (origStartSlot - sel.ss) * SH;
      if (container) {
        const targetDayIdx = od + dd;
        const tPos = getTargetDayPosition(targetDayIdx, container);
        // 鑾峰彇鐭╁舰妗嗚捣濮嬪垪鐨勭洰鏍囦綅缃紙浣滀负鍙傝€冮敋鐐癸級
        const anchorDayIdx = sel.ds + dd;
        const anchorPos = getTargetDayPosition(anchorDayIdx, container);
        if (tPos && anchorPos) {
          // 棰勮妗嗙浉瀵逛簬ghost瀹瑰櫒鐨勪綅缃?          //   left: 璇剧▼鎵€鍦ㄧ洰鏍囧垪left - ghost瀹瑰櫒left + 4px鍐呰竟璺?          absLeft = tPos.left - anchorPos.left + 4;
          //   top: 璇剧▼鎵€鍦ㄨbodyTop + 璇剧▼鏃堕棿鍋忕Щ - 鐭╁舰妗嗚捣濮媌odyTop - 鐭╁舰妗嗘椂闂村亸绉?          //        = (origStartSlot - sel.ss) * SH + (tPos.bodyTop - anchorPos.bodyTop)
          absTop = (origStartSlot - sel.ss) * SH + (tPos.bodyTop - anchorPos.bodyTop);
        }
      }
      console.log('[BatchDrag] 璇剧▼:', s.course_name||cid, '鍘熸椂闂?',fmt(sh,sm)+'-'+fmt(eh,em),
        'origSlot=',origStartSlot, 'ds=',ds, 'newSlot=',newStartSlot, '鏂版椂闂?',fmt(nsh,nsm)+'-'+fmt(neh,nem));
      return {
        id: cid,
        rd: od - sel.ds,
        rt: absTop,
        rh: Math.max(20, (origEndSlot - origStartSlot) * SH),
        left: absLeft,
        name: s.course_name || coursesRef.current.find(c => c.id === s.course_id)?.name || '课程',
        room: s.room || coursesRef.current.find(c => c.id === s.course_id)?.room_name || '',
        sh: nsh, sm: nsm, eh: neh, em: nem,
      };
    }).filter(Boolean);
    setPreviews(pv);
  }, [phase, sel, dragOff, ghost, containerRef]);

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

  // 鍒ゆ柇榧犳爣鏄惁鍦ㄨ绋嬪崱鐗囦笂
  const isOnCard = useCallback((e: MouseEvent): boolean => {
    const t = e.target as HTMLElement;
    // 妫€娴嬭绋嬪崱鐗囷紙data-course-card锛夋垨鎷栨嫿璇剧▼鍗＄墖
    return !!(t.closest('[data-course-card="true"]') || t.closest('[draggable="true"]'));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onDown = (e: MouseEvent) => {
      if (e.button === 2) {
        if (phaseRef.current === 'selected' && rbRef.current) {
          const anchor = el.querySelector('[data-anchor="true"]') as HTMLElement;
          if (anchor) {
            const ar = anchor.getBoundingClientRect();
            const mx = e.clientX - ar.left;
            const my = e.clientY - ar.top;
            const r = rbRef.current;
            if (mx >= r.l && mx <= r.l + r.w && my >= r.t && my <= r.t + r.h) {
              return;
            }
          }
        }
        // 鐭╁舰妗嗗鍙抽敭 鈫?鍙栨秷閫変腑
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

      // 浼樺厛澶勭悊鐭╁舰鍖哄煙鍐呯殑鐐瑰嚮锛氱偣鍑诲湪宸查€変腑鐨勭煩褰㈠唴锛屼笉绠℃槸涓嶆槸鍦ㄨ绋嬪崱鐗囦笂锛岄兘杩涘叆鎵归噺鎷栨嫿
      if (currentPhase === 'selected' && currentSel) {
        const inR = pos.day >= currentSel.ds && pos.day <= currentSel.de &&
                    pos.slot >= currentSel.ss && pos.slot <= currentSel.se;
        if (inR) {
          setPhase('dragging');
          setIsCopy(e.ctrlKey || e.metaKey);
          dragStartRef.current = { d: pos.day, s: pos.slot };
          setDragOff({ d: 0, s: 0 });
          console.log('[BatchDrag] 寮€濮嬫嫋鎷? clickDay=', pos.day, 'clickSlot=', pos.slot, 'sel=', JSON.stringify({ds:currentSel.ds,de:currentSel.de,ss:currentSel.ss,se:currentSel.se}));
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      // 涓嶅湪鐭╁舰鍐咃紝涓旂偣鍑诲湪璇剧▼鍗＄墖涓婏紵浜ょ粰 DailyView 澶勭悊鍗曚釜璇剧▼鎷栨嫿
      if (isOnCard(e)) return;

      // 閫変腑鐘舵€佷笅鐐瑰嚮鐭╁舰澶栵細鍏堣В閿侊紝涓嶇珛鍗冲紑濮嬫柊鐭╁舰锛堜笅娆＄偣鍑诲啀鐢伙級
      if (currentPhase === 'selected') {
        setPhase('idle');
        setSel(null);
        setDrawRect(null);
        drawPixelStartRef.current = null;
        e.preventDefault();
        return;
      }

      // 寮€濮嬫柊鐭╁舰锛堣褰曢紶鏍囩簿纭儚绱犱綅缃級
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
          // 鈶?閫愯绋嬫鏌OB锛屼笁鏉¤鍒欙細
          //   1. 寮€濮嬫椂闂?0:00 鎴?缁撴潫鏃堕棿>24:00 鈫?瓒呴檺
          //   2. 璇剧▼绉诲姩鍚庢í璺ㄤ袱鍛?鈫?瓒呴檺
          //   3. 鐭╁舰妗嗗乏鍙宠竟鐣岃秴鍑鸿绋嬭〃 鈫?瓒呴檺
          const minSlot = slot(0, 0);   // 0:00 瀵瑰簲鐨?slot = -96
          const maxSlot = slot(24, 0);  // 24:00 瀵瑰簲鐨?slot = 192
          let anyOob = false;
          let weekSet = new Set<number>(); // 璁板綍璇剧▼绉诲姩鍚庢墍鍦ㄧ殑鍛?          // 瑙勫垯3锛氱煩褰㈡宸﹀彸杈圭晫
          const nds = currentSel.ds + dd;
          const nde = currentSel.de + dd;
          if (nds < 0 || nde > 13) anyOob = true;

          currentSel.ids.forEach(cid => {
            if (anyOob) return; // 宸茶秴闄愬垯璺宠繃
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
            if (ns < minSlot || ne > maxSlot) anyOob = true;
            // 瑙勫垯2锛氳褰曡绋嬫墍鍦ㄥ懆锛坉ay0-6鈫掔1鍛紝day7-13鈫掔2鍛級
            if (nd >= 0 && nd <= 13) {
              weekSet.add(nd < 7 ? 1 : 2);
            }
          });
          // 瑙勫垯2锛氳绋嬫í璺ㄤ袱鍛ㄥ垯瓒呴檺
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
          // Step 1: 鍏堝皢rb璁句负鍍忕礌绮剧‘鐨刣rawRect浣嶇疆
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

          const minSlot = slot(0, 0);
          const maxSlot = slot(24, 0);  // 24:00 瀵瑰簲鐨?slot = 192
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
            // 鈶?澶╂暟杈圭晫锛?~13锛堜袱鍛ㄨ寖鍥达級
            if (nd_ < 0 || nd_ > 13) return;
            const nd = twoWeeksRef.current[0].add(nd_, 'day');
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

          const checkSchedules = newS.filter((x: any) => {
            // 浠呮鏌ヨ鎿嶄綔杩囩殑璇剧▼锛堢Щ鍔ㄧ殑鍘熷璇?鎴?鏂板鍒剁殑璇撅級
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
              // 璺宠繃鍙栨秷/璇峰亣鐘舵€侊紙瀹冧滑涓嶅崰鏃堕棿妲斤級
              if (other.status === ScheduleStatus.CANCELLED || other.status === ScheduleStatus.LEAVE) continue;
              if (checkItem.start_time < other.end_time && checkItem.end_time > other.start_time) {
                conflictFound = other.course_name || '鍏朵粬璇剧▼';
                break;
              }
            }
          }
          if (conflictFound) {
            message.warning(`鏃堕棿鍐茬獊锛氫笌銆?{conflictFound}銆嶆椂闂存閲嶅彔锛屾壒閲忔搷浣滃凡鎾ら攢`);
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
        const anchor = el.querySelector('[data-anchor="true"]') as HTMLElement;
        if (!anchor) return false;
        const ar = anchor.getBoundingClientRect();
        const mx = e.clientX - ar.left;
        const my = e.clientY - ar.top;
        const r = rbRef.current!;
        return mx >= r.l && mx <= r.l + r.w && my >= r.t && my <= r.t + r.h;
      })();
      if (isInRb) {
        // 鐭╁舰妗嗗唴鍙抽敭 鈫?闃绘娴忚鍣ㄨ彍鍗曪紝璁?Dropdown 鎺ョ
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
        {/* 缁樺埗涓細鍍忕礌绮剧‘鐭╁舰璺熼殢榧犳爣锛堝鍣ㄧ浉瀵瑰潗鏍囷紝position:absolute锛?*/}
        {phase === 'drawing' && drawRect && (
          <div style={{ position: 'absolute', left: drawRect.l, top: drawRect.t, width: drawRect.w, height: Math.max(20, drawRect.h), border: '2px dashed #1890ff', background: 'rgba(24,144,255,0.06)', borderRadius: 4, zIndex: 101, pointerEvents: 'none' }} />
        )}
        {/* 閫変腑鍚庯細鏌辩姸瀵归綈鐭╁舰甯﹁繃娓″姩鐢?+ 鍙抽敭鑿滃崟锛堜綅缃?absolute 鐩稿瀹瑰櫒锛岄殢婊氬姩绉诲姩锛?*/}
        {phase === 'selected' && rb && (
          <Dropdown
            trigger={['contextMenu']}
            menu={{
              items: [
                {
                  key: 'batch-delete',
                  label: '馃棏锔?鍏ㄩ儴鍒犻櫎',
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
                  宸查€?{sel.ids.length} 璇?路 鎷栨嫿绉诲姩 路 Ctrl+鎷栨嫿澶嶅埗 路 鍙抽敭鏇村
                </div>
              )}
            </div>
          </Dropdown>
        )}
        {phase === 'dragging' && ghost && (
          <div style={{ position: 'absolute', left: ghost.l, top: ghost.t, width: ghost.w, height: ghost.h, border: '2px dashed #faad14', background: 'rgba(250,173,20,0.12)', borderRadius: 4, zIndex: 102, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: oob ? -28 : -24, left: 4, background: oob ? '#ff4d4f' : '#faad14', color: '#fff', padding: '1px 8px', borderRadius: 10, fontSize: 11, whiteSpace: 'nowrap', fontWeight: oob ? 'bold' : 'normal' }}>
              {oob ? '超出范围' : `${isCopy ? '复制中' : '移动中'} · 松开确认`}
            </div>
            {previews.map((p: any) => (
              <div key={p.id} style={{ position: 'absolute', left: p.left ?? (p.rd * (CW + GAP) + 4), top: p.rt, width: CW - 8, height: p.rh, background: isCopy ? 'rgba(82,196,26,0.25)' : 'rgba(24,144,255,0.25)', border: isCopy ? '2px dashed #52c41a' : '2px dashed #1890ff', borderRadius: 6, padding: 2, fontSize: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', boxShadow: isCopy ? '0 4px 20px rgba(82,196,26,0.3)' : '0 4px 20px rgba(24,144,255,0.3)' }}>
                <div style={{ fontWeight: 'bold', lineHeight: 1.2, color: isCopy ? '#52c41a' : '#1890ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: CW - 16, textAlign: 'center' }}>{isCopy ? '馃搵 ' : ''}{p.name}</div>
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
        {/* 鎵归噺鍒犻櫎纭妗?*/}
        <Modal
          open={deleteConfirmVisible}
          title="纭鎵归噺鍒犻櫎"
          okText="纭鍒犻櫎"
          cancelText="鍙栨秷"
          okButtonProps={{ danger: true }}
          onCancel={() => { setDeleteConfirmVisible(false); setFlashingIds([]); }}
          onOk={() => {
            if (flashingIds.length > 0) {
              if (onBatchDelete) {
                onBatchDelete(flashingIds);
              } else {
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
        {/* 闂儊楂樹寒鍔ㄧ敾鏍峰紡 - 浠呭畾涔塳eyframes锛岀敱inline animation灞炴€цЕ鍙?*/}
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

