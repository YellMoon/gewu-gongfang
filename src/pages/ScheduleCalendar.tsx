import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Modal, Form, Input, InputNumber, Select, DatePicker, TimePicker, Calendar, Divider, Card, Row, Col, Button, message, Space, Dropdown, Alert
} from 'antd';
import type { MenuProps } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { CourseType, ScheduleStatus, Course, Teacher, Student, BillingUnit } from '../types';
import useBatchSelection from './useBatchSelection';
import { v4 as uuidv4 } from 'uuid';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import isoWeek from 'dayjs/plugin/isoWeek';
import { holidays2026, getUpcomingHolidays } from '../utils/helpers';

dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);


const { Option } = Select;

const MIN_START_HOUR = 8;
const MAX_END_HOUR = 23;
const SLOT_DURATION = 5; // 鈶?鏈€灏?鍒嗛挓璋冩暣
const SLOT_HEIGHT = 2.5; // 姣?鍒嗛挓2.5px楂橈紝淇濇寔鍘熸€婚珮搴︿笉鍙?const COLUMN_WIDTH = 140;
const SIDEBAR_WIDTH = 220;
const DEFAULT_DURATION_HOURS = 2;
const WEEK_GRID_BODY_HEIGHT = ((MAX_END_HOUR - MIN_START_HOUR) * 60 / SLOT_DURATION) * SLOT_HEIGHT;
const WEEK_GRID_TITLE_HEIGHT = 30;
const WEEK_GRID_DEFAULT_HEIGHT = WEEK_GRID_BODY_HEIGHT + WEEK_GRID_TITLE_HEIGHT;
const GLOBAL_MAX_SLOT = ((24 - MIN_START_HOUR) * 60) / SLOT_DURATION; // 192 = 24:00

function calculateTotalSlots() {
  return ((MAX_END_HOUR - MIN_START_HOUR) * 60) / SLOT_DURATION;
}

function timeToSlot(hour: number, minute: number) {
  const totalMins = (hour - MIN_START_HOUR) * 60 + minute;
  return Math.floor(totalMins / SLOT_DURATION);
}

function slotToTime(slot: number) {
  const totalMins = slot * SLOT_DURATION;
  const hour = MIN_START_HOUR + Math.floor(totalMins / 60);
  const minute = totalMins % 60;
  return { hour, minute };
}

function formatTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export interface ScheduleEvent {
  id: string;
  course_id: string;
  course_name: string;
  course_type: CourseType;
  start_time: string;
  end_time: string;
  status: ScheduleStatus;
  room?: string;
  notes?: string;
  course_year?: string;
  course_semester?: string;
}

interface DailyViewProps {
  day: Dayjs;
  dayIndex: number;
  schedules: ScheduleEvent[];
  minHour?: number;
  maxHour?: number;
  selectedCourseIds?: string[];
  batchPhase?: 'idle' | 'drawing' | 'selected' | 'dragging';
  batchIsCopy?: boolean;
  flashingIds?: string[];
  flashToggle?: boolean;
  onDoubleClickDate: (day: Dayjs) => void;
  onDoubleClickSchedule: (schedule: ScheduleEvent) => void;
  onScheduleStatusChange: (id: string, status: ScheduleStatus) => void;
  onDropCourse: (course: Course, day: Dayjs, slot: number) => void;
  onDragSchedule?: (schedule: ScheduleEvent, newDay: Dayjs, newSlot: number, ctrlKey: boolean) => void;
  onResizeSchedule?: (schedule: ScheduleEvent, newStartSlot: number | null, newEndSlot: number | null) => void;
  onDeleteSchedule?: (id: string) => void;
  onOpenStudentEdit?: (schedule: ScheduleEvent) => void;
}

const DailyView: React.FC<DailyViewProps> = ({
  day,
  dayIndex,
  schedules,
  minHour = 8,
  maxHour = 23,
  selectedCourseIds = [],
  batchPhase = 'idle',
  batchIsCopy = false,
  flashingIds = [],
  flashToggle = false,
  onDoubleClickDate,
  onDoubleClickSchedule,
  onScheduleStatusChange,
  onDropCourse,
  onDragSchedule,
  onResizeSchedule,
  onDeleteSchedule,
  onOpenStudentEdit
}) => {
  const dateStr = day.format('YYYY-MM-DD');
  const daySchedules = schedules.filter(s => s.start_time.startsWith(dateStr));
  const todayStr = dayjs().format('YYYY-MM-DD');
  const isToday = dateStr === todayStr;

  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const [dragState, setDragState] = useState<{
    type: 'move' | 'resize-top' | 'resize-bottom';
    schedule: ScheduleEvent;
    startSlot: number;
    endSlot: number;
    startY: number;
    currentY: number;
    currentX: number;
    ctrlKey: boolean;
    ghostVisible: boolean;
  } | null>(null);
  const dayBodyRef = useRef<HTMLDivElement>(null);
  const dragStartPosRef = useRef<{ x: number, y: number } | null>(null);
  const hasDraggedRef = useRef(false);

  const holiday = holidays2026.find(h => 
    dateStr >= h.start && dateStr <= h.end
  );
  const isHoliday = !!holiday;
  const holidayName = holiday?.name || '';

  // 鈶?鍔ㄦ€佽绠楁€籹lot鏁帮紙鍩轰簬璇剧▼瀹為檯鏃堕棿鑼冨洿锛?  const effectiveMaxEndSlot = ((maxHour - MIN_START_HOUR) * 60) / SLOT_DURATION;
  // 鈶?鏃╀簬8鐐圭殑璇剧▼闇€瑕佸悜涓嬫暣浣撲綅绉?  const earlyOffset = minHour < MIN_START_HOUR ? ((MIN_START_HOUR - minHour) * 60 / SLOT_DURATION * SLOT_HEIGHT) : 0;
  let maxEndSlot = effectiveMaxEndSlot;
  daySchedules.forEach(s => {
    const [, timeStr] = s.end_time.split(' ');
    const [endH, endM] = timeStr.split(':').map(Number);
    const endSlot = timeToSlot(endH, endM) + 1;
    if (endSlot > maxEndSlot) maxEndSlot = endSlot;
  });

  function getStatusStyle(status: ScheduleStatus) {
    switch (status) {
      case ScheduleStatus.PLANNED:
        return { background: '#e6f7ff', border: '2px solid #1890ff', opacity: 1 };
      case ScheduleStatus.COMPLETED:
        return { background: '#f6ffed', border: '2px solid #52c41a', opacity: 0.8 };
      case ScheduleStatus.LEAVE:
        return { background: '#fff7e6', border: '2px solid #faad14', opacity: 1 };
      case ScheduleStatus.CANCELLED:
        return { background: '#fff1f0', border: '2px solid #f5222d', opacity: 0.6 };
      default:
        return { background: '#e6f7ff', border: '2px solid #1890ff', opacity: 1 };
    }
  }

  function getCoursePosition(schedule: ScheduleEvent) {
    const [, startTime] = schedule.start_time.split(' ');
    const [, endTime] = schedule.end_time.split(' ');
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const startSlot = timeToSlot(startH, startM);
    const endSlot = timeToSlot(endH, endM);
    return { top: startSlot * SLOT_HEIGHT, height: (endSlot - startSlot) * SLOT_HEIGHT, startSlot, endSlot };
  }

  function getCurrentDragPosition(schedule: ScheduleEvent) {
    const [, startTime] = schedule.start_time.split(' ');
    const [, endTime] = schedule.end_time.split(' ');
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    let startSlot = timeToSlot(startH, startM);
    let endSlot = timeToSlot(endH, endM);
    
    if (dragState && dragState.schedule.id === schedule.id) {
      // Ctrl+鎷栨嫿锛堝鍒讹級锛氬師璇剧▼妗嗕綅缃浐瀹氫笉鍔紝鍙湁铏氬奖璺熼殢榧犳爣
      if (dragState.type === 'move' && dragState.ctrlKey) {
        return { top: startSlot * SLOT_HEIGHT, height: (endSlot - startSlot) * SLOT_HEIGHT, startSlot, endSlot };
      }
      // 缁熶竴锛氳櫄褰变笂杈规部瀵瑰簲slot = (mouseY - ghostHeight/2 - bodyRect.top) / SLOT_HEIGHT
      if (dragState.type === 'move' && dayBodyRef.current) {
        const durationSlots = endSlot - startSlot;
        const dragGhostHeight = Math.max(24, durationSlots * SLOT_HEIGHT);
        const bodyRect = dayBodyRef.current.getBoundingClientRect();
        const ghostTopY = dragState.currentY - dragGhostHeight / 2;
        startSlot = Math.max(0, Math.round((ghostTopY - bodyRect.top) / SLOT_HEIGHT));
        endSlot = startSlot + durationSlots;
        // 缁撴潫鏃堕棿涓嶈秴杩?4:00
        if (endSlot > GLOBAL_MAX_SLOT) {
          startSlot = Math.max(0, GLOBAL_MAX_SLOT - durationSlots);
          endSlot = startSlot + durationSlots;
        }
        return { top: startSlot * SLOT_HEIGHT, height: (endSlot - startSlot) * SLOT_HEIGHT, startSlot, endSlot };
      }
      // resize锛氫娇鐢ㄥ師鏈夊亸绉昏绠?      const slotDiff = Math.round((dragState.currentY - dragState.startY) / SLOT_HEIGHT);
        
      if (dragState.type === 'move') {
        startSlot += slotDiff;
        endSlot += slotDiff;
      } else if (dragState.type === 'resize-top') {
        startSlot += slotDiff;
      } else if (dragState.type === 'resize-bottom') {
        endSlot += slotDiff;
      }
      
      startSlot = Math.max(0, startSlot);
      endSlot = Math.max(startSlot + 1, Math.min(endSlot, GLOBAL_MAX_SLOT));
    }
    
    return { top: startSlot * SLOT_HEIGHT, height: (endSlot - startSlot) * SLOT_HEIGHT, startSlot, endSlot };
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOverSlot(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const slot = Math.floor(y / SLOT_HEIGHT);
    const course = (window as any).courseDragData;
    if (course) {
      onDropCourse(course, day, slot);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const slot = Math.floor(y / SLOT_HEIGHT);
    setDragOverSlot(slot);
  }

  function handleDragLeave() {
    setDragOverSlot(null);
  }

  const handleScheduleMouseDown = useCallback((e: React.MouseEvent, schedule: ScheduleEvent, hitZone: 'body' | 'top' | 'bottom') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    
    const rect = e.currentTarget.getBoundingClientRect();
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    hasDraggedRef.current = false;
    
    const [, startTime] = schedule.start_time.split(' ');
    const [, endTime] = schedule.end_time.split(' ');
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const startSlot = timeToSlot(startH, startM);
    const endSlot = timeToSlot(endH, endM);
    
    // 鈶?鍗曞嚮鏃朵笉鏄剧ず铏氬奖锛実hostVisible=false锛岀瓑榧犳爣绉诲姩瓒呰繃闃堝€兼墠鏄剧ず
    if (hitZone === 'top') {
      setDragState({ type: 'resize-top', schedule, startSlot, endSlot, startY: e.clientY, currentY: e.clientY, currentX: e.clientX, ctrlKey: e.ctrlKey, ghostVisible: false });
    } else if (hitZone === 'bottom') {
      setDragState({ type: 'resize-bottom', schedule, startSlot: endSlot, endSlot, startY: e.clientY, currentY: e.clientY, currentX: e.clientX, ctrlKey: e.ctrlKey, ghostVisible: false });
    } else {
      setDragState({ type: 'move', schedule, startSlot, endSlot, startY: e.clientY, currentY: e.clientY, currentX: e.clientX, ctrlKey: e.ctrlKey, ghostVisible: false });
    }
  }, []);

  React.useEffect(() => {
    if (!dragState) return;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (dragStartPosRef.current && !hasDraggedRef.current) {
        const dx = Math.abs(moveEvent.clientX - dragStartPosRef.current.x);
        const dy = Math.abs(moveEvent.clientY - dragStartPosRef.current.y);
        if (dx > 3 || dy > 3) {
          hasDraggedRef.current = true;
        }
      }
      
      setDragState(prev => {
        if (!prev) return null;
        return { ...prev, currentY: moveEvent.clientY, currentX: moveEvent.clientX, ctrlKey: moveEvent.ctrlKey, ghostVisible: prev.ghostVisible || hasDraggedRef.current };
      });
    };
    
    const handleMouseUp = (upEvent: MouseEvent) => {
      if (hasDraggedRef.current && dragState && dayBodyRef.current) {
        
        // 鈶?妫€娴嬮紶鏍囨墍鍦ㄦ棩鏈熷垪锛堟敮鎸佽法鏃ユ湡銆佽法鍛ㄦ嫋鎷斤級
        let targetDay = day;
        const elem = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        let targetDayCol: HTMLElement | null = null;
        if (elem) {
          targetDayCol = elem.closest('[data-date]') as HTMLElement;
          if (targetDayCol && targetDayCol.dataset.date) {
            const foundDate = dayjs(targetDayCol.dataset.date);
            if (foundDate.isValid()) {
              targetDay = foundDate;
            }
          }
        }
        
        // 鈶?缁熶竴slot璁＄畻锛氳櫄褰变笂杈规部瀵瑰簲鏃堕棿 = (mouseY - ghostHeight/2 - bodyRect.top) / SLOT_HEIGHT
        const durationSlots = dragState.endSlot - dragState.startSlot;
        const dragGhostHeight = Math.max(24, durationSlots * SLOT_HEIGHT);
        let targetSlot = 0;
        if (dragState.type === 'move' && targetDayCol) {
          const targetBody = targetDayCol.querySelector('[data-day-body="true"]') as HTMLElement;
          if (targetBody) {
            const bodyRect = targetBody.getBoundingClientRect();
            const ghostTopY = upEvent.clientY - dragGhostHeight / 2;
            targetSlot = Math.max(0, Math.round((ghostTopY - bodyRect.top) / SLOT_HEIGHT));
          }
        } else {
          // resize: 浣跨敤鍘熸湁鍋忕Щ璁＄畻
          const slotDiff = Math.round((upEvent.clientY - dragState.startY) / SLOT_HEIGHT);
          targetSlot = dragState.startSlot + slotDiff;
        }
        
        // 鈶?鏀惧slot杈圭晫妫€鏌ワ紝鐢ㄥ叏灞€鑼冨洿
        // const globalMaxSlot = ((24 - MIN_START_HOUR) * 60) / SLOT_DURATION;
        
        if (dragState.type === 'move') {
          if (targetSlot >= 0) {
            // 缁撴潫鏃堕棿涓嶈秴杩?4:00锛歴tartSlot + duration <= GLOBAL_MAX_SLOT
            const durationSlots = dragState.endSlot - dragState.startSlot;
            const maxStartSlot = GLOBAL_MAX_SLOT - durationSlots;
            const adjustedSlot = Math.max(0, Math.min(targetSlot, maxStartSlot));
            onDragSchedule?.(dragState.schedule, targetDay, adjustedSlot, upEvent.ctrlKey);
          }
        } else if (dragState.type === 'resize-top') {
          if (targetSlot >= 0 && targetSlot < GLOBAL_MAX_SLOT) {
            onResizeSchedule?.(dragState.schedule, targetSlot, null);
          }
        } else if (dragState.type === 'resize-bottom') {
          if (targetSlot >= 0) {
            // 缁撴潫鏃堕棿涓嶈秴杩?4:00
            const adjustedSlot = Math.min(targetSlot, GLOBAL_MAX_SLOT);
            onResizeSchedule?.(dragState.schedule, null, adjustedSlot);
          }
        }
      }
      
      setDragState(null);
      dragStartPosRef.current = null;
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, day, maxEndSlot, onDragSchedule, onResizeSchedule]);

  const handleScheduleClick = useCallback((e: React.MouseEvent, schedule: ScheduleEvent) => {
    if (hasDraggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const handleScheduleDoubleClick = useCallback((e: React.MouseEvent, schedule: ScheduleEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!hasDraggedRef.current) {
      onDoubleClickSchedule(schedule);
    }
  }, [onDoubleClickSchedule]);

  const getContextMenuItems = (schedule: ScheduleEvent): MenuProps['items'] => [
    {
      key: 'delete',
      label: '馃棏锔?鍒犻櫎璇剧▼',
      danger: true,
      onClick: () => {
        onDeleteSchedule?.(schedule.id);
      }
    },
    { type: 'divider' },
    {
      key: 'normal',
      label: '鉁?璁句负姝ｅ父',
      disabled: schedule.status === ScheduleStatus.PLANNED,
      onClick: () => onScheduleStatusChange(schedule.id, ScheduleStatus.PLANNED)
    },
    {
      key: 'leave',
      label: '馃彔 璁句负璇峰亣',
      disabled: schedule.status === ScheduleStatus.LEAVE,
      onClick: () => onScheduleStatusChange(schedule.id, ScheduleStatus.LEAVE)
    },
    {
      key: 'cancelled',
      label: '鉂?璁句负鍙栨秷',
      disabled: schedule.status === ScheduleStatus.CANCELLED,
      onClick: () => onScheduleStatusChange(schedule.id, ScheduleStatus.CANCELLED)
    },
    { type: 'divider' },
    {
      key: 'student-edit',
      label: '馃懃 瀛︾敓鍑哄嫟鍜岃垂鐢?,
      onClick: () => onOpenStudentEdit?.(schedule)
    }
  ];

  const weekDays = ['鍛ㄤ竴', '鍛ㄤ簩', '鍛ㄤ笁', '鍛ㄥ洓', '鍛ㄤ簲', '鍛ㄥ叚', '鍛ㄦ棩'];

  return (
    <div style={{
      width: COLUMN_WIDTH,
      border: '2px solid #d9d9d9',
      borderRadius: 8,
      overflow: 'hidden',
      background: isToday ? '#e6f7ff' : (isHoliday ? '#fff1f0' : 'white'),
      borderColor: isToday ? '#1890ff' : '#d9d9d9'
    }} data-date={dateStr}>
      <div
        onDoubleClick={() => onDoubleClickDate(day)}
        style={{
          padding: '8px 4px',
          background: isHoliday ? '#f5222d' : '#1890ff',
          color: 'white',
          textAlign: 'center',
          fontWeight: 'bold',
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        <div>{weekDays[dayIndex]}{isHoliday ? `锛?{holidayName}锛塦 : ''}</div>
        <div style={{ fontSize: 12, fontWeight: 'normal', marginTop: 2 }}>
          {day.format('M鏈圖鏃?)}
        </div>
      </div>

      <div
        ref={dayBodyRef}
        data-day-body="true"
        style={{ position: 'relative', height: maxEndSlot * SLOT_HEIGHT, background: 'white', paddingTop: earlyOffset }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* 鏃╀簬8鐐圭殑鏃堕棿鏍煎瓙绾匡紙鑷姩鍦╬adding鍖哄煙鍐呭亸绉伙級 */}
        {earlyOffset > 0 && Array.from({ length: Math.floor((MIN_START_HOUR - minHour) * 60 / SLOT_DURATION / 12) }).filter((_, si) => {
          const earlyHour = MIN_START_HOUR - (si + 1);
          const top = (earlyHour - MIN_START_HOUR) * 12 * SLOT_HEIGHT;
          return top >= -(earlyOffset);
        }).map((_, si) => {
          const earlyHour = MIN_START_HOUR - (si + 1);
          const top = (earlyHour - MIN_START_HOUR) * 12 * SLOT_HEIGHT;
          return (
            <div
              key={`early-${si}`}
              style={{
                position: 'absolute',
                top: top,
                left: 0,
                right: 0,
                height: 1,
                borderBottom: '1px solid rgba(0,0,0,0.08)'
              }}
            />
          );
        })}
        {/* 8鐐瑰強涔嬪悗鐨勬椂闂存牸瀛愮嚎鏉?- 60鍒嗛挓闂撮殧锛屽崐閫忔槑锛堣嚜鍔ㄥ欢浼歌嚦maxEndSlot锛?*/}
        {Array.from({ length: Math.ceil(maxEndSlot / 12) }).map((_, slotIdx) => {
          const lineTop = slotIdx * 12 * SLOT_HEIGHT;
          // 鍙覆鏌撳湪maxEndSlot鑼冨洿鍐呯殑绾挎潯锛岄伩鍏嶆棤闄愬欢浼?          if (lineTop >= maxEndSlot * SLOT_HEIGHT) return null;
          return (
            <div
              key={slotIdx}
              style={{
                position: 'absolute',
                top: lineTop,
                left: 0,
                right: 0,
                height: 1,
                borderBottom: '1px solid rgba(0,0,0,0.08)'
              }}
            />
          );
        })}
        {/* 缁撴潫鏃堕棿搴曠嚎锛氱‘淇濊秴鍑烘渶鍚庝竴鏍兼椂浠嶆湁搴曡竟绾?*/}
        <div style={{
          position: 'absolute',
          top: maxEndSlot * SLOT_HEIGHT - 1,
          left: 0, right: 0,
          height: 1,
          borderBottom: '1px solid rgba(0,0,0,0.08)'
        }} />

        {/* 鎷栧叆璇剧▼棰勮 */}
        {dragOverSlot !== null && (() => {
          const { hour, minute } = slotToTime(dragOverSlot);
          const dragCourse = (window as any).courseDragData as Course | undefined;
          const startStr = formatTime(hour, minute);
          const durMin = dragCourse?.default_duration_minutes || 120;
          const endSlot = dragOverSlot + Math.floor(durMin / 5);
          const endH = MIN_START_HOUR + Math.floor(endSlot * 5 / 60);
          const endM = (endSlot * 5) % 60;
          const endStr = formatTime(endH, endM);
          const roomInfo = dragCourse?.room_name || dragCourse?.room_id || '';
          return (
            <div style={{
              position: 'absolute',
              top: dragOverSlot * SLOT_HEIGHT,
              left: 4,
              right: 4,
              height: Math.max(24, Math.floor(durMin / 5) * SLOT_HEIGHT),
              background: 'rgba(24,144,255,0.25)',
              border: '2px dashed #1890ff',
              borderRadius: 6,
              zIndex: 50,
              pointerEvents: 'none',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              boxShadow: '0 4px 20px rgba(24,144,255,0.3)'
            }}>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: '#1890ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                {dragCourse ? (dragCourse.display_name || dragCourse.name.replace(/^\d{4}\s+\S+瀛︽湡\s+/, '')) : '璇剧▼'}
              </div>
              <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                {roomInfo && <span>{roomInfo} </span>}
                <span style={{ color: '#ff4d4f', fontWeight: 'bold', background: 'rgba(255,77,79,0.15)', padding: '0 2px', borderRadius: 2 }}>{startStr}</span>
                <span> - </span>
                <span style={{ color: '#ff4d4f', fontWeight: 'bold', background: 'rgba(255,77,79,0.15)', padding: '0 2px', borderRadius: 2 }}>{endStr}</span>
              </div>
            </div>
          );
        })()}

        {daySchedules.map(schedule => {
          // 鎵归噺 Ctrl+鎷栨嫿锛堝鍒讹級鏃跺師璇剧▼妗嗕笉鍔紝鏅€氭嫋鎷芥椂鎵嶉殣钘?          if (batchPhase === 'dragging' && !batchIsCopy && selectedCourseIds.includes(schedule.id)) return null;
          const pos = dragState && dragState.schedule.id === schedule.id 
            ? getCurrentDragPosition(schedule) 
            : getCoursePosition(schedule);
          const isDragging = dragState && dragState.schedule.id === schedule.id;
          const isFlashing = flashingIds.includes(schedule.id);

          return (
            <React.Fragment key={schedule.id}>
              <Dropdown
                menu={{ items: getContextMenuItems(schedule) }}
                trigger={['contextMenu']}
              >
                <div
                  data-course-card="true"
                  data-course-id={schedule.id}
                  style={{
                    position: 'absolute',
                    top: pos.top,
                    left: 4,
                    right: 4,
                    height: pos.height,
                    minHeight: 24,
                    borderRadius: 6,
                    padding: '2px 4px',
                    cursor: isDragging ? 'grabbing' : 'move',
                    ...getStatusStyle(schedule.status),
                    zIndex: isDragging ? 100 : 10,
                    opacity: isDragging && dragState.ghostVisible && dragState.type === 'move' && !dragState.ctrlKey ? 0 : 1,
                    boxShadow: isDragging && dragState.ghostVisible && dragState.type === 'move' && !dragState.ctrlKey ? 'none' : (isDragging && dragState.ghostVisible ? '0 4px 16px rgba(24,144,255,0.4)' : 'none'),
                    transition: (isDragging && dragState.ghostVisible) ? 'none' : 'all 0.1s',
                    // 鈶?Ctrl+鎷栨嫿鏃跺師妗嗕繚鎸佸畬鏁翠笉閫忔槑锛屼粎缁胯壊铏氱嚎杈规楂樹寒
                    border: isDragging && dragState.ghostVisible && dragState.ctrlKey ? '3px dashed #52c41a' : undefined,
                    // 鎵归噺鍒犻櫎闂儊鍔ㄧ敾
                    animation: isFlashing ? 'batchFlash 0.6s ease-in-out infinite' : undefined,
                  }}
                  onClick={(e) => handleScheduleClick(e, schedule)}
                  onDoubleClick={(e) => handleScheduleDoubleClick(e, schedule)}
                  onMouseDown={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const relY = e.clientY - rect.top;
                    if (relY <= 6) {
                      handleScheduleMouseDown(e, schedule, 'top');
                    } else if (relY >= rect.height - 6) {
                      handleScheduleMouseDown(e, schedule, 'bottom');
                    } else {
                      handleScheduleMouseDown(e, schedule, 'body');
                    }
                  }}
                >
                  {/* 璇剧▼妗嗗唴瀹硅嚜閫傚簲灞呬腑 */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    overflow: 'hidden',
                    justifyContent: 'center',
                    alignItems: 'center'
                  }}>
                    <div style={{
                      fontSize: 12,
                      fontWeight: 'bold',
                      color: '#1890ff',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.2,
                      textAlign: 'center',
                      maxWidth: '100%',
                      flexShrink: 0
                    }}>
                      {schedule.course_name}
                    </div>

                    <div style={{
                      fontSize: 10,
                      color: '#666',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.2,
                      textAlign: 'center',
                      maxWidth: '100%',
                      flexShrink: 0,
                      marginTop: 1
                    }}>
                      {schedule.room && `${schedule.room} `}
                      {isDragging ? (() => {
                        const cs = pos.startSlot;
                        const ce = pos.endSlot;
                        const sh = Math.floor(cs / 12) + 8;
                        const sm = (cs % 12) * 5;
                        const eh = Math.floor(ce / 12) + 8;
                        const em = (ce % 12) * 5;
                        const st = `${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}`;
                        const et = `${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`;
                        // 鈶?Ctrl+鎷栨嫿鏃跺師妗嗘椂闂翠笉楂樹寒锛屼粎鍦ㄦ櫘閫氭嫋鎷?resize鏃堕珮浜?                        const isCtrlDrag = dragState.ctrlKey;
                        const highlightStart = (dragState.type === 'move' && !isCtrlDrag) || dragState.type === 'resize-top';
                        const highlightEnd = (dragState.type === 'move' && !isCtrlDrag) || dragState.type === 'resize-bottom';
                        return <>
                          <span style={{ color: highlightStart ? '#ff4d4f' : '#666', fontWeight: highlightStart ? 'bold' : 'normal', background: highlightStart ? 'rgba(255,77,79,0.15)' : 'none', padding: '0 2px', borderRadius: 2 }}>{st}</span>
                          <span style={{ color: '#666' }}>-</span>
                          <span style={{ color: highlightEnd ? '#ff4d4f' : '#666', fontWeight: highlightEnd ? 'bold' : 'normal', background: highlightEnd ? 'rgba(255,77,79,0.15)' : 'none', padding: '0 2px', borderRadius: 2 }}>{et}</span>
                        </>;
                      })() : (
                        <>
                          {schedule.start_time.split(' ')[1].substr(0, 5)}-{schedule.end_time.split(' ')[1].substr(0, 5)}
                        </>
                      )}
                    </div>
                  </div>
                  {/* 杈规部resize鍖哄煙 */}
                  <div style={{
                    position: 'absolute',
                    top: -2,
                    left: 0,
                    right: 0,
                    height: 6,
                    cursor: 'n-resize',
                    zIndex: 20
                  }} />
                  <div style={{
                    position: 'absolute',
                    bottom: -2,
                    left: 0,
                    right: 0,
                    height: 6,
                    cursor: 's-resize',
                    zIndex: 20
                  }} />
                </div>
              </Dropdown>
            </React.Fragment>
          );
        })}
      </div>
      {/* 鈶犫憽 璺ㄦ棩鏈?璺ㄥ懆鎷栨嫿娴姩铏氬奖 - 灏哄涓庣湡瀹炶绋嬫涓€鑷达紝鈶や粎绉诲姩瓒呰繃闃堝€兼樉绀?*/}
      {dragState && dragState.type === 'move' && dragState.ghostVisible && (() => {
        const durationSlots = dragState.endSlot - dragState.startSlot;
        const ghostHeight = Math.max(24, durationSlots * SLOT_HEIGHT);
        const ghostWidth = COLUMN_WIDTH - 8;
        
        // 鈶?铏氬奖鏃堕棿鍩轰簬涓婅竟娌?ghostY=currentY-ghostHeight/2)璁＄畻锛岃€岄潪榧犳爣涓績
        let ghostStartSlot = 0;
        if (dayBodyRef.current) {
          const bodyRect = dayBodyRef.current.getBoundingClientRect();
          const ghostTopY = dragState.currentY - ghostHeight / 2;
          ghostStartSlot = Math.max(0, Math.round((ghostTopY - bodyRect.top) / SLOT_HEIGHT));
        }
        // 鈶?妫€娴嬫槸鍚﹁法鏃?璺ㄥ懆锛岀敤鐩爣day body閲嶇畻
        try {
          const elem = document.elementFromPoint(dragState.currentX, dragState.currentY);
          if (elem) {
            const dayCol = elem.closest('[data-date]') as HTMLElement;
            if (dayCol && dayCol.dataset.date && dayCol.dataset.date !== dateStr) {
              const targetBody = dayCol.querySelector('[data-day-body="true"]') as HTMLElement;
              if (targetBody) {
                const bodyRect = targetBody.getBoundingClientRect();
                const ghostTopY = dragState.currentY - ghostHeight / 2;
                ghostStartSlot = Math.max(0, Math.round((ghostTopY - bodyRect.top) / SLOT_HEIGHT));
              }
            }
          }
        } catch(e) {}
        
        const ghostEndSlot = ghostStartSlot + durationSlots;
        // 缁撴潫鏃堕棿涓嶈秴杩?4:00
        if (ghostEndSlot > GLOBAL_MAX_SLOT) {
          ghostStartSlot = Math.max(0, GLOBAL_MAX_SLOT - durationSlots);
        }
        const ghostEndSlotClamped = Math.min(ghostEndSlot, GLOBAL_MAX_SLOT);
        const sh = Math.floor(ghostStartSlot / 12) + 8;
        const sm = (ghostStartSlot % 12) * 5;
        const eh = Math.floor(ghostEndSlotClamped / 12) + 8;
        const em = (ghostEndSlotClamped % 12) * 5;
        const startTimeStr = String(sh).padStart(2,'0') + ':' + String(sm).padStart(2,'0');
        const endTimeStr = String(eh).padStart(2,'0') + ':' + String(em).padStart(2,'0');
        let ghostX = (dragState.currentX || 0) - ghostWidth / 2;
        let ghostY = (dragState.currentY || 0) - ghostHeight / 2;
        const isCopy = dragState.ctrlKey;
        return (
        <div style={{
          position: 'fixed',
          left: ghostX,
          top: ghostY,
          width: ghostWidth,
          height: ghostHeight,
          borderRadius: 6,
          background: isCopy ? 'rgba(82,196,26,0.25)' : 'rgba(24,144,255,0.25)',
          border: isCopy ? '2px dashed #52c41a' : '2px dashed #1890ff',
          zIndex: 9999,
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          boxShadow: isCopy ? '0 4px 20px rgba(82,196,26,0.3)' : '0 4px 20px rgba(24,144,255,0.3)'
        }}>
          {/* 鈶?涓よ甯冨眬锛屽拰鐪熷疄璇剧▼妗嗗畬鍏ㄤ竴鑷达細璇剧▼鍚?+ 涓婅鍦板潃&璧锋鏃堕棿 */}
          <div style={{ fontSize: 12, fontWeight: 'bold', color: isCopy ? '#52c41a' : '#1890ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2, textAlign: 'center', maxWidth: ghostWidth - 8, flexShrink: 0 }}>
            {isCopy ? '馃搵 ' : ''}{dragState.schedule.course_name}
          </div>
          <div style={{ fontSize: 10, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2, textAlign: 'center', maxWidth: ghostWidth - 8, flexShrink: 0, marginTop: 2 }}>
            {dragState.schedule.room && `${dragState.schedule.room} `}
            <span style={{ color: '#ff4d4f', fontWeight: 'bold', background: 'rgba(255,77,79,0.15)', padding: '0 2px', borderRadius: 2 }}>{startTimeStr}</span>
            <span style={{ color: '#666' }}>-</span>
            <span style={{ color: '#ff4d4f', fontWeight: 'bold', background: 'rgba(255,77,79,0.15)', padding: '0 2px', borderRadius: 2 }}>{endTimeStr}</span>
          </div>
        </div>
        );
      })()}
    </div>
  );
};

interface TwoWeeksViewProps {
  schedules: ScheduleEvent[];
  currentMonday: Dayjs;
  selectedTeacherId: string | undefined;
  courses: Course[];
  selectedCourseIds?: string[];
  batchPhase?: 'idle' | 'drawing' | 'selected' | 'dragging';
  batchIsCopy?: boolean;
  flashingIds?: string[];
  flashToggle?: boolean;
  onDoubleClickDate: (day: Dayjs) => void;
  onDoubleClickSchedule: (schedule: ScheduleEvent) => void;
  onScheduleStatusChange: (id: string, status: ScheduleStatus) => void;
  onDropCourse: (course: Course, day: Dayjs, slot: number) => void;
  onDragSchedule?: (schedule: ScheduleEvent, newDay: Dayjs, newSlot: number, ctrlKey: boolean) => void;
  onResizeSchedule?: (schedule: ScheduleEvent, newStartSlot: number | null, newEndSlot: number | null) => void;
  onDeleteSchedule?: (id: string) => void;
  onOpenStudentEdit?: (schedule: ScheduleEvent) => void;
}

const OneWeekRow: React.FC<{
  startMonday: Dayjs;
  weekLabel: string;
  schedules: ScheduleEvent[];
  selectedCourseIds?: string[];
  batchPhase?: 'idle' | 'drawing' | 'selected' | 'dragging';
  batchIsCopy?: boolean;
  flashingIds?: string[];
  flashToggle?: boolean;
  onDoubleClickDate: (day: Dayjs) => void;
  onDoubleClickSchedule: (schedule: ScheduleEvent) => void;
  onScheduleStatusChange: (id: string, status: ScheduleStatus) => void;
  onDropCourse: (course: Course, day: Dayjs, slot: number) => void;
  onDragSchedule?: (schedule: ScheduleEvent, newDay: Dayjs, newSlot: number, ctrlKey: boolean) => void;
  onResizeSchedule?: (schedule: ScheduleEvent, newStartSlot: number | null, newEndSlot: number | null) => void;
  onDeleteSchedule?: (id: string) => void;
  onOpenStudentEdit?: (schedule: ScheduleEvent) => void;
}> = ({
  startMonday,
  weekLabel,
  schedules,
  selectedCourseIds = [],
  batchPhase = 'idle',
  batchIsCopy = false,
  flashingIds = [],
  flashToggle = false,
  onDoubleClickDate,
  onDoubleClickSchedule,
  onScheduleStatusChange,
  onDropCourse,
  onDragSchedule,
  onResizeSchedule,
  onDeleteSchedule,
  onOpenStudentEdit
}) => {
  const weekDays: Dayjs[] = [];
  for (let i = 0; i < 7; i++) {
    weekDays.push(startMonday.add(i, 'day'));
  }

  // 鈶?璁＄畻鏈懆鐨勫姩鎬佹椂闂磋寖鍥?  const weekDateStr = startMonday.format('YYYY-MM-DD');
  const nextMondayStr = startMonday.add(7, 'day').format('YYYY-MM-DD');
  const visibleSchedules = schedules.filter(s => {
    if (s.status === ScheduleStatus.CANCELLED || s.status === ScheduleStatus.LEAVE) return false;
    const sDate = s.start_time.substring(0, 10);
    return sDate >= weekDateStr && sDate < nextMondayStr;
  });
  
  let dynMinHour = 8, dynMaxHour = 23;
  visibleSchedules.forEach(s => {
    const [, startT] = s.start_time.split(' ');
    const [, endT] = s.end_time.split(' ');
    const [sh, sm] = startT.split(':').map(Number);
    const [eh, em] = endT.split(':').map(Number);
    const startHour = sh + sm / 60;
    const endHour = eh + em / 60;
    if (startHour < dynMinHour) dynMinHour = Math.floor(startHour);
    if (endHour > dynMaxHour) dynMaxHour = Math.ceil(endHour);
  });

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 8, color: '#666' }}>
        {weekLabel}: {startMonday.format('M鏈圖鏃?)} ~ {startMonday.add(6, 'day').format('M鏈圖鏃?)}
      </div>
      <div style={{ overflowX: 'auto', display: 'flex', gap: 8 }}>
        {weekDays.map((day, idx) => (
          <DailyView
            key={idx}
            day={day}
            dayIndex={idx}
            schedules={schedules}
            minHour={dynMinHour}
            maxHour={dynMaxHour}
            selectedCourseIds={selectedCourseIds}
            batchPhase={batchPhase}
            batchIsCopy={batchIsCopy}
            flashingIds={flashingIds}
            flashToggle={flashToggle}
            onDoubleClickDate={onDoubleClickDate}
            onDoubleClickSchedule={onDoubleClickSchedule}
            onScheduleStatusChange={onScheduleStatusChange}
            onDropCourse={onDropCourse}
            onDragSchedule={onDragSchedule}
            onResizeSchedule={onResizeSchedule}
            onDeleteSchedule={onDeleteSchedule}
            onOpenStudentEdit={onOpenStudentEdit}
          />
        ))}
      </div>
    </div>
  );
};

const TwoWeeksView: React.FC<TwoWeeksViewProps> = ({
  schedules,
  currentMonday,
  selectedTeacherId,
  courses,
  selectedCourseIds = [],
  batchPhase = 'idle',
  batchIsCopy = false,
  flashingIds = [],
  flashToggle = false,
  onDoubleClickDate,
  onDoubleClickSchedule,
  onScheduleStatusChange,
  onDropCourse,
  onDragSchedule,
  onResizeSchedule,
  onDeleteSchedule,
  onOpenStudentEdit
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);

  const filteredSchedules = schedules.filter(schedule => {
    if (!selectedTeacherId) return false; // 鈶?娌℃湁閫変腑鑰佸笀鏃朵笉鏄剧ず浠讳綍璇剧▼
    const course = courses.find(c => c.id === schedule.course_id);
    return !course || course.teacher_id === selectedTeacherId;
  });

  return (
    <div style={{ minHeight: '100%', paddingRight: 8 }}>
      <OneWeekRow
        startMonday={currentMonday}
        weekLabel="鏈懆"
        schedules={filteredSchedules}
        selectedCourseIds={selectedCourseIds}
        batchPhase={batchPhase}
        batchIsCopy={batchIsCopy}
        flashingIds={flashingIds}
        flashToggle={flashToggle}
        onDoubleClickDate={onDoubleClickDate}
        onDoubleClickSchedule={onDoubleClickSchedule}
        onScheduleStatusChange={onScheduleStatusChange}
        onDropCourse={onDropCourse}
        onDragSchedule={onDragSchedule}
        onResizeSchedule={onResizeSchedule}
        onDeleteSchedule={onDeleteSchedule}
        onOpenStudentEdit={onOpenStudentEdit}
      />
      <OneWeekRow
        startMonday={currentMonday.add(1, 'week')}
        weekLabel="涓嬪懆"
        schedules={filteredSchedules}
        selectedCourseIds={selectedCourseIds}
        batchPhase={batchPhase}
        batchIsCopy={batchIsCopy}
        flashingIds={flashingIds}
        flashToggle={flashToggle}
        onDoubleClickDate={onDoubleClickDate}
        onDoubleClickSchedule={onDoubleClickSchedule}
        onScheduleStatusChange={onScheduleStatusChange}
        onDropCourse={onDropCourse}
        onDragSchedule={onDragSchedule}
        onResizeSchedule={onResizeSchedule}
        onDeleteSchedule={onDeleteSchedule}
        onOpenStudentEdit={onOpenStudentEdit}
      />
    </div>
  );
};

interface SidebarProps {
  teachers: Teacher[];
  selectedTeacherId: string | undefined;
  courses: Course[];
  onTeacherChange: (teacherId: string | undefined) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  teachers,
  selectedTeacherId,
  courses,
  onTeacherChange
}) => {
  const filteredCourses = (courses || []).filter(c =>
    c.active === true && (!selectedTeacherId || c.teacher_id === selectedTeacherId)
  );

  function handleDragStart(e: React.DragEvent, course: Course) {
    e.dataTransfer.setData('courseId', course.id);
    (window as any).courseDragData = course;
    e.dataTransfer.effectAllowed = 'copy';
    // 闅愯棌娴忚鍣ㄩ粯璁ゆ嫋鎷借櫄褰?    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(img, 0, 0);
  }

  return (
    <div style={{
      width: SIDEBAR_WIDTH,
      borderRight: '1px solid #d9d9d9',
      padding: 16,
      background: '#fafafa',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      overflow: 'hidden'
    }}>
      {teachers.length > 0 && (
        <div style={{ flexShrink: 0 }}>
          <h4 style={{ margin: '0 0 8px 0' }}>馃懆鈥嶐煆?閫夋嫨鑰佸笀</h4>
          <Select
            style={{ width: '100%', marginBottom: 8 }}
            placeholder="閫夋嫨鑰佸笀"
            allowClear
            showSearch
            value={selectedTeacherId}
            onChange={onTeacherChange}
            options={teachers.map(t => ({ label: t.name, value: t.id }))}
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
          <Divider style={{ margin: '8px 0' }} />
        </div>
      )}
      {selectedTeacherId && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <h4 style={{ margin: '0 0 8px 0', flexShrink: 0 }}>
            馃摎 鏈粨璇剧▼ ({filteredCourses.length})
          </h4>
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
        {filteredCourses.map(course => (
          <div
            key={course.id}
            draggable={course.active}
            onDragStart={e => handleDragStart(e, course)}
            style={{
              padding: '6px 10px',
              background: course.active ? 'white' : '#f5f5f5',
              border: '1px solid ' + (course.active ? '#d9d9d9' : '#ccc'),
              borderRadius: 6,
              cursor: course.active ? 'grab' : 'not-allowed',
              transition: 'all 0.3s',
              opacity: course.active ? 1 : 0.6,
              flexShrink: 0
            }}
            onMouseEnter={e => {
              if (!course.active) return;
              e.currentTarget.style.borderColor = '#1890ff';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
            }}
            onMouseLeave={e => {
              if (!course.active) return;
              e.currentTarget.style.borderColor = '#d9d9d9';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{ fontWeight: 'bold', fontSize: 13, color: '#1890ff' }}>
              {course.display_name || course.name.replace(/^\d{4}\s+\S+瀛︽湡\s+/, '')}
            </div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>
              {course.year || course.name?.match(/^(\d{4})/)?.[1] || '-'}骞磠' '}
              {course.semester || course.name?.match(/^\d{4}\s+(\S+瀛︽湡)/)?.[1] || '-'}
            </div>
            {course.type !== undefined && (
              <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>
                {course.room_name && `${course.room_name} `}{course.type === CourseType.ONE_ON_ONE ? '涓€瀵逛竴' : course.type === CourseType.ONE_ON_TWO ? '涓€瀵逛簩' : '鐝'}
              </div>
            )}
          </div>
        ))}
        {filteredCourses.length === 0 && (
          <div style={{ textAlign: 'center', color: '#999', padding: '20px 0', fontSize: 14 }}>
            鏆傛棤鏈粨璇剧▼
          </div>
        )}
          </div>
        </div>
      )}
      {!selectedTeacherId && teachers.length > 0 && (
        <div style={{ textAlign: 'center', color: '#999', padding: '40px 0', fontSize: 14 }}>
          璇峰厛閫夋嫨鑰佸笀
        </div>
      )}
    </div>
  );
};

const ScheduleCalendar: React.FC = () => {
  const [schedules, setSchedules] = useState<ScheduleEvent[]>([]);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const today = dayjs();
  let initialMonday = today.startOf('isoWeek'); // 鍛ㄤ竴涓轰竴鍛ㄨ捣鐐?  const [currentMonday, setCurrentMonday] = useState<Dayjs>(initialMonday);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleEvent | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [form] = Form.useForm();
  const [courses, setCourses] = useState<Course[]>([]);
  
  const [studentEditModal, setStudentEditModal] = useState({
    open: false,
    schedule: null as ScheduleEvent | null
  });
  const [studentEditForm] = Form.useForm();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | undefined>(undefined);
  const [teacherInitialized, setTeacherInitialized] = useState(false);

  const [batchDates, setBatchDates] = useState<Dayjs[]>([dayjs()]);
  const [refreshModalVisible, setRefreshModalVisible] = useState(false);
  const [refreshDateRange, setRefreshDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [modalTeacherId, setModalTeacherId] = useState<string | undefined>(undefined);

  // 鈶?鎿嶄綔鍥為€€/鍓嶈繘锛坲ndo/redo锛?  const MAX_HISTORY = 10;
  const [history, setHistory] = useState<{ past: ScheduleEvent[][]; future: ScheduleEvent[][] }>({ past: [], future: [] });
  const pastRef = useRef(history.past);
  const futureRef = useRef(history.future);
  useEffect(() => { pastRef.current = history.past; }, [history.past]);
  useEffect(() => { futureRef.current = history.future; }, [history.future]);

  // 鈶?甯﹀巻鍙茶褰曠殑 setSchedules 鍖呰
  const setSchedulesWithHistory = useCallback((newSchedulesOrUpdater: ScheduleEvent[] | ((prev: ScheduleEvent[]) => ScheduleEvent[])) => {
    setSchedules(prev => {
      const newSchedules = typeof newSchedulesOrUpdater === 'function'
        ? newSchedulesOrUpdater(prev)
        : newSchedulesOrUpdater;
      // 鍙湪鏁版嵁瀹為檯鍙樺寲鏃惰褰曞巻鍙?      const isChanged = JSON.stringify(newSchedules) !== JSON.stringify(prev);
      if (isChanged) {
        setHistory(h => ({
          past: [...h.past.slice(-(MAX_HISTORY - 1)), [...prev]], // 淇濆瓨鍙樻洿鍓嶇姸鎬?          future: [], // 鏂版搷浣滄竻绌洪噸鍋氭爤
        }));
      }
      return newSchedules;
    });
  }, []);

  // 鎵归噺閫夋嫨鎷栨嫿锛堜娇鐢ㄥ巻鍙插寘瑁呭洖璋冿級
  const { batchVisuals, phase: batchPhase, selectedCourseIds, isCopy: batchIsCopy, flashingIds, flashToggle, setSchedules: setBatchSchedules, setCourses: setBatchCourses } = useBatchSelection(containerRef, currentMonday, setSchedulesWithHistory, (ids: string[]) => {
    // 鎵归噺鍒犻櫎鍥炶皟锛氫粠schedules涓Щ闄ゆ寚瀹欼D鐨勮绋嬶紝骞惰鍏ュ巻鍙?    setSchedulesWithHistory(prev => prev.filter(s => !ids.includes(s.id)));
    message.success(`宸插垹闄?${ids.length} 鑺傝绋媊);
  });

  // 鈶?鎾ら攢 Ctrl+Z
  const undo = useCallback(() => {
    const past = pastRef.current;
    if (past.length === 0) return;
    const prevState = past[past.length - 1];
    setSchedules(cur => {
      setHistory(h => ({
        past: h.past.slice(0, -1),
        future: [...h.future, [...cur]],
      }));
      return prevState;
    });
    setBatchSchedules(prevState);
  }, [setBatchSchedules]);

  // 鈶?閲嶅仛 Ctrl+Y
  const redo = useCallback(() => {
    const future = futureRef.current;
    if (future.length === 0) return;
    const nextState = future[future.length - 1];
    setSchedules(cur => {
      setHistory(h => ({
        past: [...h.past, [...cur]],
        future: h.future.slice(0, -1),
      }));
      return nextState;
    });
    setBatchSchedules(nextState);
  }, [setBatchSchedules]);

  // 鈶?Ctrl+Z / Ctrl+Y 蹇嵎閿?  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  React.useEffect(() => {
    const loadData = () => {
      try {
        const db = (window as any).dbService;
        if (!db) {
          setTimeout(loadData, 1000);
          return;
        }
        const savedSchedules = localStorage.getItem('schedules');
        if (savedSchedules) {
          const parsed = JSON.parse(savedSchedules);
          setSchedules(parsed);
          setBatchSchedules(parsed);
        }
        if (db.getAllCourses) {
          const coursesData = db.getAllCourses();
          setCourses([...coursesData]);
          setBatchCourses([...coursesData]);
          // 鑷姩鍚屾鏃堕棿琛ㄧ殑 room 涓庤绋嬫渶鏂?room_name锛屼互鍙?course_name锛堝寘鍚勾浠藉鏈燂級
          setSchedules(prev => prev.map(s => {
            const course = coursesData.find((c: Course) => c.id === s.course_id);
            if (course) {
              const updated: Partial<ScheduleEvent> = {};
              if (course.room_name && s.room !== course.room_name) {
                updated.room = course.room_name;
              }
              // 鍚屾璇剧▼鍚嶇О锛堝彧鏄剧ず绾绋嬪悕锛屼笉鍚勾浠藉鏈燂級
              const displayCourseName = course.display_name || course.name.replace(/^\d{4}\s+\S+瀛︽湡\s+/, '');
              if (displayCourseName && s.course_name !== displayCourseName) {
                updated.course_name = displayCourseName;
              }
              // 鍚屾璇剧▼骞翠唤鍜屽鏈?              const courseYear = course.year !== undefined ? String(course.year) : undefined;
              const courseSemester = course.semester || undefined;
              if (s.course_year !== courseYear) {
                updated.course_year = courseYear;
              }
              if (s.course_semester !== courseSemester) {
                updated.course_semester = courseSemester;
              }
              if (Object.keys(updated).length > 0) {
                return { ...s, ...updated };
              }
            }
            return s;
          }));
        }
        if (db.getAllTeachers) {
          const teachersData = db.getAllTeachers();
          setTeachers([...teachersData]);
        }
        if (db.getAllStudents) {
          setAllStudents([...db.getAllStudents()]);
        }
        if (db.getAllRooms) {
          setRooms(db.getAllRooms());
        }
      } catch (e) {
        console.error('鍔犺浇鏁版嵁澶辫触', e);
      }
    };
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  // 鈶?鑷姩閫夋嫨绗竴浣嶈€佸笀
  React.useEffect(() => {
    if (!teacherInitialized && teachers.length > 0) {
      setSelectedTeacherId(teachers[0].id);
      setTeacherInitialized(true);
    }
  }, [teachers, teacherInitialized]);

  React.useEffect(() => {
    try {
      localStorage.setItem('schedules', JSON.stringify(schedules));
      setBatchSchedules(schedules);
    } catch (e) {
      console.error('淇濆瓨鏁版嵁澶辫触', e);
    }
  }, [schedules, setBatchSchedules]);

  function handleDoubleClickDate(day: Dayjs) {
    setEditingSchedule(null);
    form.resetFields();
    setModalTeacherId(undefined);
    form.setFieldValue('date', day);
    setBatchDates([day]);
    setModalVisible(true);
  }

  function handleDoubleClickSchedule(schedule: ScheduleEvent) {
    setEditingSchedule(schedule);
    const [dateStr, timeStr] = schedule.start_time.split(' ');
    const [, endTimeStr] = schedule.end_time.split(' ');
    const startTimeDayjs = dayjs(`1970-01-01 ${timeStr}`);
    const endTimeDayjs = dayjs(`1970-01-01 ${endTimeStr}`);
    const diffMinutes = endTimeDayjs.diff(startTimeDayjs, 'minute');
    const durationHours = diffMinutes / 60;
    const course = courses.find(c => c.id === schedule.course_id);
    
    form.resetFields();
    setModalTeacherId(course?.teacher_id);
    form.setFieldsValue({
      date: dayjs(dateStr),
      startTime: startTimeDayjs,
      endTime: endTimeDayjs,
      duration: durationHours,
      courseId: schedule.course_id,
      courseName: schedule.course_name,
      teacherId: course?.teacher_id,
      status: schedule.status,
      room: (course?.room_id && course.room_id.split(',')[0].trim()) || (rooms.find(r => r.name === schedule.room)?.id) || schedule.room,
      notes: schedule.notes,
    });
    setBatchDates([dayjs(dateStr)]);
    setModalVisible(true);
  }

  function handleOpenStudentEdit(schedule: ScheduleEvent) {
    const course = courses.find(c => c.id === schedule.course_id);
    if (course) {
      const initialValues = {
        students: (course.student_pricings || []).map(sp => ({
          student_id: sp.student_id,
          tuition: sp.tuition,
          teacher_fee: sp.teacher_fee || sp.tuition,
          status: sp.status || ScheduleStatus.PLANNED  // 鈶?璇诲彇宸蹭繚瀛樼殑鍑哄嫟鐘舵€侊紝涓嶅啀寮哄埗閲嶇疆
        }))
      };
      studentEditForm.setFieldsValue(initialValues);
      setStudentEditModal({ open: true, schedule });
    }
  }

  const courseStudentPricings = (() => {
    if (!studentEditModal.schedule) return [];
    const course = courses.find(c => c.id === (studentEditModal.schedule as any).course_id);
    return course?.student_pricings || [];
  })();

  // 褰撳墠璇剧▼鐨勮璐瑰崟浣?  const billingCourse = studentEditModal.schedule
    ? courses.find(c => c.id === (studentEditModal.schedule as any).course_id)
    : null;
  const billingUnitLabel = (() => {
    const buRaw = (billingCourse as any)?.billing_unit;
    // 鍏煎鏁板瓧/瀛楃涓?undefined
    const bu = buRaw !== undefined && buRaw !== null ? Number(buRaw) : null;
    if (bu === BillingUnit.PER_HOUR) return '/灏忔椂';
    if (bu === BillingUnit.PER_SESSION) return '/娆?;
    // 鏈缃椂榛樿鎸夋璇撅紙甯歌鍦烘櫙锛?    return '/娆?;
  })();

  function handleSaveStudentEdit() {
    const values = studentEditForm.getFieldsValue();
    if (studentEditModal.schedule) {
      const course = courses.find(c => c.id === (studentEditModal.schedule as any).course_id);
      if (course && course.student_pricings) {
        const updatedPricings = course.student_pricings.map((sp, idx) => ({
          ...sp,
          ...values.students[idx]
        }));
        const updatedCourses = courses.map(c => 
          c.id === course.id ? { ...c, student_pricings: updatedPricings } : c
        );
        setCourses(updatedCourses);
        // 鈶?閫氳繃 dbService.updateCourse 鍐欏叆 browserDatabase锛堝瓨鍒?scheduling_system_db_v3锛?        const db = (window as any).dbService;
        if (db?.updateCourse) {
          db.updateCourse(course.id, { student_pricings: updatedPricings });
        }
        message.success('瀛︾敓淇℃伅淇敼鎴愬姛');
        setStudentEditModal({ open: false, schedule: null });
      }
    }
  }

  function handleScheduleStatusChange(id: string, status: ScheduleStatus) {
    const changedSchedule = schedules.find(s => s.id === id);
    setSchedulesWithHistory(prev => prev.map(s => s.id === id ? { ...s, status } : s));
    message.success('鐘舵€佸凡鏇存柊');
    if (changedSchedule) {
      const statusLabels: Record<string, string> = {
        [ScheduleStatus.PLANNED]: '姝ｅ父',
        [ScheduleStatus.COMPLETED]: '宸插畬鎴?,
        [ScheduleStatus.LEAVE]: '璇峰亣',
        [ScheduleStatus.CANCELLED]: '鍙栨秷',
      };
      (window as any).operateLogger?.log('淇敼', `淇敼鎺掕銆?{changedSchedule.course_name}銆嶇姸鎬佷负銆?{statusLabels[status] || status}銆峘, '璇剧▼琛?);
    }
  }

  function handleDropCourse(course: Course, day: Dayjs, slot: number) {
    // 璇剧▼琛ㄥ彧鏄剧ず绾绋嬪悕
    const displayCourseName = course.display_name || course.name.replace(/^\d{4}\s+\S+瀛︽湡\s+/, '');
    const { hour: startH, minute: startM } = slotToTime(slot);
    const startTime = dayjs(day).hour(startH).minute(startM).second(0);
    // 鏈夐粯璁ゆ椂闀匡細鐩存帴鍒涘缓璇剧▼妗嗭紝涓嶅脊绐?    if (course.default_duration_minutes) {
      const endTime = startTime.add(course.default_duration_minutes, 'minute');
      const overlap = checkOverlap('', startTime.format('YYYY-MM-DD HH:mm'), endTime.format('YYYY-MM-DD HH:mm'));
      if (overlap) {
        message.warning(`涓庛€?{overlap.course_name}銆嶆椂闂村啿绐侊紝璇疯皟鏁翠綅缃甡);
        return;
      }
      const newSchedule: ScheduleEvent = {
        id: uuidv4(),
        course_id: course.id,
        course_name: displayCourseName,
        course_type: course.type,
        start_time: startTime.format('YYYY-MM-DD HH:mm'),
        end_time: endTime.format('YYYY-MM-DD HH:mm'),
        status: ScheduleStatus.PLANNED,
        room: course.room_id || course.room_name || '',
        course_year: course.year !== undefined ? String(course.year) : undefined,
        course_semester: course.semester || undefined,
      };
      const newSchedules = [...schedules, newSchedule];
      setSchedulesWithHistory(newSchedules);
      setBatchSchedules(newSchedules);
      message.success(`宸叉坊鍔犮€?{displayCourseName}銆?${startTime.format('HH:mm')}-${endTime.format('HH:mm')})`);
      (window as any).operateLogger?.log('鍒涘缓', `鍒涘缓鎺掕銆?{displayCourseName}銆?${startTime.format('YYYY-MM-DD HH:mm')}-${endTime.format('YYYY-MM-DD HH:mm')})`, '璇剧▼琛?);
      return;
    }
    // 鏃犻粯璁ゆ椂闀匡細寮圭獥鎵嬪姩璁剧疆
    const endTime = startTime.add(DEFAULT_DURATION_HOURS, 'hour');
    setEditingSchedule(null);
    form.resetFields();
    setModalTeacherId(course.teacher_id);
    form.setFieldsValue({
      date: day,
      startTime: startTime,
      endTime: endTime,
      courseId: course.id,
      courseName: displayCourseName,
      teacherId: course.teacher_id,
      room: course.room_id || course.room_name,
      status: ScheduleStatus.PLANNED,
    });
    setBatchDates([day]);
    setModalVisible(true);
  }

  function checkOverlap(scheduleId: string, newStart: string, newEnd: string): ScheduleEvent | null {
    return schedules.find(s => {
      if (s.id === scheduleId) return false;
      if (s.status === ScheduleStatus.CANCELLED || s.status === ScheduleStatus.LEAVE) return false;
      return s.start_time < newEnd && s.end_time > newStart;
    }) || null;
  }

  function handleDragSchedule(schedule: ScheduleEvent, newDay: Dayjs, newSlot: number, ctrlKey: boolean) {
    const { hour: startH, minute: startM } = slotToTime(newSlot);
    const [, oldStartTimeStr] = schedule.start_time.split(' ');
    const [, oldEndTimeStr] = schedule.end_time.split(' ');
    const oldStartDayjs = dayjs(`1970-01-01 ${oldStartTimeStr}`);
    const oldEndDayjs = dayjs(`1970-01-01 ${oldEndTimeStr}`);
    const durationMinutes = oldEndDayjs.diff(oldStartDayjs, 'minute');
    
    const newStartTime = dayjs(newDay).hour(startH).minute(startM).second(0);
    let newEndTime = newStartTime.add(durationMinutes, 'minute');
    // 缁撴潫鏃堕棿涓嶈秴杩?4:00锛氳法鍗堝鏃堕檺鍒跺埌23:55
    if (newEndTime.format('YYYY-MM-DD') !== newStartTime.format('YYYY-MM-DD')) {
      newEndTime = newStartTime.hour(23).minute(55);
    }
    const newStartTimeStr = newStartTime.format('YYYY-MM-DD HH:mm');
    const newEndTimeStr = newEndTime.format('YYYY-MM-DD HH:mm');
    
    // 鈶?鏃堕棿浜掓枼妫€娴?    if (!ctrlKey) {
      const overlap = checkOverlap(schedule.id, newStartTimeStr, newEndTimeStr);
      if (overlap) {
        message.warning(`鏃堕棿閲嶅彔锛氫笌銆?{overlap.course_name}銆?${overlap.start_time.substring(11,16)}-${overlap.end_time.substring(11,16)})鍐茬獊锛屽凡鎭㈠`);
        return;
      }
    }
    
    if (ctrlKey) {
      const newSchedule = {
        ...schedule,
        id: uuidv4(),
        start_time: newStartTimeStr,
        end_time: newEndTimeStr
      };
      setSchedulesWithHistory(prev => [...prev, newSchedule]);
      message.success('璇剧▼宸插鍒?);
      (window as any).operateLogger?.log('澶嶅埗', `澶嶅埗鎺掕銆?{schedule.course_name}銆嶅埌${newStartTimeStr.substring(0,10)} ${newStartTimeStr.substring(11,16)}-${newEndTimeStr.substring(11,16)}`, '璇剧▼琛?);
    } else {
      setSchedulesWithHistory(prev => prev.map(s => 
        s.id === schedule.id 
          ? { ...s, start_time: newStartTimeStr, end_time: newEndTimeStr }
          : s
      ));
      message.success('璇剧▼宸茬Щ鍔?);
      (window as any).operateLogger?.log('绉诲姩', `绉诲姩鎺掕銆?{schedule.course_name}銆嶅埌${newStartTimeStr.substring(0,10)} ${newStartTimeStr.substring(11,16)}-${newEndTimeStr.substring(11,16)}`, '璇剧▼琛?);
    }
  }

  function handleResizeSchedule(schedule: ScheduleEvent, newStartSlot: number | null, newEndSlot: number | null) {
    const [, oldStartTimeStr] = schedule.start_time.split(' ');
    const [, oldEndTimeStr] = schedule.end_time.split(' ');
    let [startH, startM] = oldStartTimeStr.split(':').map(Number);
    let [endH, endM] = oldEndTimeStr.split(':').map(Number);
    
    if (newStartSlot !== null) {
      const { hour, minute } = slotToTime(newStartSlot);
      startH = hour;
      startM = minute;
    }
    if (newEndSlot !== null) {
      const adjustedSlot = Math.min(newEndSlot, GLOBAL_MAX_SLOT);
      const { hour, minute } = slotToTime(adjustedSlot);
      endH = hour;
      endM = minute;
    }
    
    const dateStr = schedule.start_time.split(' ')[0];
    const newStartTime = `${dateStr} ${formatTime(startH, startM)}`;
    const newEndTime = `${dateStr} ${formatTime(endH, endM)}`;
    
    // 鈶?鏃堕棿浜掓枼妫€娴?    const overlap = checkOverlap(schedule.id, newStartTime, newEndTime);
    if (overlap) {
      message.warning(`鏃堕棿閲嶅彔锛氫笌銆?{overlap.course_name}銆?${overlap.start_time.substring(11,16)}-${overlap.end_time.substring(11,16)})鍐茬獊锛屽凡鎭㈠`);
      return;
    }
    
    setSchedulesWithHistory(prev => prev.map(s => 
      s.id === schedule.id 
        ? { ...s, start_time: newStartTime, end_time: newEndTime }
        : s
    ));
    message.success('璇剧▼鏃堕棿宸茶皟鏁?);
  }

  function handleDeleteSchedule(id: string) {
    if (window.confirm('纭畾瑕佸垹闄よ繖鑺傝绋嬪悧锛?)) {
      const deletedSchedule = schedules.find(s => s.id === id);
      setSchedulesWithHistory(prev => prev.filter(s => s.id !== id));
      message.success('璇剧▼宸插垹闄?);
      if (deletedSchedule) {
        (window as any).operateLogger?.log('鍒犻櫎', `鍒犻櫎鎺掕銆?{deletedSchedule.course_name}銆峘, '璇剧▼琛?);
      }
    }
  }

  function handleSave() {
    const values = form.getFieldsValue();
    if (!values.startTime) { message.warning('璇烽€夋嫨寮€濮嬫椂闂?); return; }
    if (!values.duration) { message.warning('璇烽€夋嫨璇剧▼鏃堕暱'); return; }
    if (!values.teacherId) { message.warning('璇烽€夋嫨鑰佸笀'); return; }
    if (!values.courseId) { message.warning('璇烽€夋嫨璇剧▼'); return; }
    form.validateFields().then(values => {
      const startDayjs = values.startTime;
      const durationHours = values.duration || DEFAULT_DURATION_HOURS;
      const endDayjs = startDayjs.add(durationHours * 60, 'minute');
      
      const course = courses.find(c => c.id === values.courseId);
      const courseName = course?.name || values.courseName;
      
      const datesToSave = batchDates.length > 0 ? batchDates : [values.date];
      const newSchedules: ScheduleEvent[] = [];
      
      datesToSave.forEach((dateDayjs, index) => {
        const dateStr = dateDayjs.format('YYYY-MM-DD');
        const startTimeStr = `${dateStr} ${startDayjs.format('HH:mm')}`;
        const endTimeStr = `${dateStr} ${endDayjs.format('HH:mm')}`;
        
        // 鈶?鏃堕棿浜掓枼妫€娴嬶紙鎺掕绐楀彛锛?        const eId = editingSchedule?.id || '';
        const overlap = checkOverlap(eId, startTimeStr, endTimeStr);
        if (overlap) {
          message.warning(`鏃堕棿閲嶅彔锛?{dateStr}涓庛€?{overlap.course_name}銆?${overlap.start_time.substring(11,16)}-${overlap.end_time.substring(11,16)})鍐茬獊锛屽凡鎭㈠`);
          return;
        }
        
        if (editingSchedule && index === 0) {
          setSchedulesWithHistory(prev => prev.map(s =>
            s.id === editingSchedule.id
              ? {
                  ...s,
                  start_time: startTimeStr,
                  end_time: endTimeStr,
                  course_id: values.courseId,
                  course_name: courseName,
                  status: values.status || ScheduleStatus.PLANNED,
                  room: rooms.find(r => r.id === values.room)?.name || courses.find(c => c.id === values.courseId)?.room_name || values.room,
                  notes: values.notes,
                  course_year: course?.year !== undefined ? String(course?.year) : undefined,
                  course_semester: course?.semester || undefined,
                }
              : s
          ));
          (window as any).operateLogger?.log('淇敼', `淇敼鎺掕銆?{courseName}銆嶆椂闂?${startTimeStr.substring(11,16)}-${endTimeStr.substring(11,16)}`, '璇剧▼琛?);
        } else {
          const courseObj = courses.find(c => c.id === values.courseId);
          const newSchedule: ScheduleEvent = {
            id: uuidv4(),
            course_id: values.courseId,
            course_name: courseName,
            course_type: course?.type || CourseType.ONE_ON_ONE,
            start_time: startTimeStr,
            end_time: endTimeStr,
            status: values.status || ScheduleStatus.PLANNED,
            room: rooms.find(r => r.id === values.room)?.name || courseObj?.room_name || values.room,
            notes: values.notes,
            course_year: courseObj && courseObj.year !== undefined ? String(courseObj.year) : undefined,
            course_semester: courseObj?.semester || undefined,
          };
          newSchedules.push(newSchedule);
        }
      });
      
      if (newSchedules.length > 0) {
        setSchedulesWithHistory(prev => [...prev, ...newSchedules]);
        const logDetail = `鎵归噺鍒涘缓鎺掕锛?{datesToSave.length}鑺傦級- ${newSchedules.map(s => s.course_name.split(' ')[0]).filter(Boolean).join(', ')}`;
        (window as any).operateLogger?.log('鍒涘缓', logDetail, '璇剧▼琛?);
      }
      
      const msg = datesToSave.length > 1 ? `宸叉坊鍔?{datesToSave.length}鑺傝绋媊 : '璇剧▼宸蹭繚瀛?;
      message.success(msg);
      setModalVisible(false);
    }).catch(err => {
      console.error(err);
    });
  }

  function goPrevWeek() {
    setCurrentMonday(prev => prev.subtract(1, 'week'));
  }

  function goNextWeek() {
    setCurrentMonday(prev => prev.add(1, 'week'));
  }

  function goToday() {
    setCurrentMonday(today.startOf('isoWeek'));
  }

  function handleAddSchedule() {
    setEditingSchedule(null);
    form.resetFields();
    setModalTeacherId(undefined);
    form.setFieldValue('date', dayjs());
    setBatchDates([dayjs()]);
    setModalVisible(true);
  }

  function handleRefreshCourseInfo() {
    if (!refreshDateRange) {
      message.warning('璇烽€夋嫨鏃ユ湡鑼冨洿');
      return;
    }
    const [startDate, endDate] = refreshDateRange;
    const db = (window as any).dbService;
    let count = 0;
    const updated = schedules.map(s => {
      const sDate = dayjs(s.start_time.split(' ')[0]);
      if (sDate.isBefore(startDate) || sDate.isAfter(endDate)) return s;
      const course = db?.getAllCourses?.()?.find((c: any) => c.id === s.course_id);
      if (!course) return s;
      const displayCName = course.display_name || course.name.replace(/^\d{4}\s+\S+瀛︽湡\s+/, '');
      count++;
      return { 
        ...s, 
        course_name: displayCName || s.course_name, 
        room: course.room_name || s.room,
        course_type: course.type || s.course_type,
        course_year: course.year !== undefined ? String(course.year) : undefined,
        course_semester: course.semester || undefined,
      };
    });
    setSchedulesWithHistory(updated);
    message.success(`宸叉洿鏂?${count} 鏉¤绋嬩俊鎭痐);
    setRefreshModalVisible(false);
    setRefreshDateRange(null);
  }

  const upcomingHolidays = getUpcomingHolidays();

  return (
    <div style={{ padding: 16, height: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}>
      <Card size="small" style={{ marginBottom: 8, flexShrink: 0 }}>
        <Space wrap>
          <Button onClick={goPrevWeek}>鈫?涓婂懆</Button>
          <Button onClick={goToday}>鏈懆</Button>
          <Button onClick={goNextWeek}>涓嬪懆 鈫?/Button>
          <Button 
            onClick={() => setCalendarOpen(!calendarOpen)}
            title="鐐瑰嚮璺宠浆鍒伴€夊畾鏃ユ湡鐨勮绋嬭〃"
          >
            馃搮 閫夋嫨鏃ユ湡
          </Button>
          {calendarOpen && (
            <div style={{ 
              position: 'absolute', 
              zIndex: 100, 
              background: 'white', 
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)', 
              borderRadius: 8, 
              padding: 8, 
              marginTop: 8 
            }}>
              <Calendar
                fullscreen={false}
                onSelect={(date) => {
                  const monday = date.startOf('isoWeek');
                  setCurrentMonday(monday);
                  setCalendarOpen(false);
                }}
              />
            </div>
          )}
          <Divider type="vertical" />
          <Button 
            onClick={undo} 
            disabled={history.past.length === 0}
            title="鎾ら攢 (Ctrl+Z)"
          >鈫╋笍 鎾ら攢</Button>
          <Button 
            onClick={redo} 
            disabled={history.future.length === 0}
            title="閲嶅仛 (Ctrl+Y)"
          >鈫笍 閲嶅仛</Button>
          <Divider type="vertical" />
          <Button 
            onClick={() => {
              setRefreshDateRange([currentMonday, currentMonday.add(13, 'day')]);
              setRefreshModalVisible(true);
            }}
            title="鍒锋柊鏃ユ湡鑼冨洿鍐呮墍鏈夋帓璇剧殑璇剧▼淇℃伅"
          >
            馃攧 鍒锋柊璇剧▼淇℃伅
          </Button>
          <Divider type="vertical" />
          <Button type="primary" onClick={handleAddSchedule}>鉃?鎺掕</Button>
        </Space>
      </Card>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: 0 }}>
        <Sidebar
          teachers={teachers}
          selectedTeacherId={selectedTeacherId}
          courses={courses}
          onTeacherChange={setSelectedTeacherId}
        />

        <div style={{ overflowY: 'auto', overflowX: 'auto', flex: 1, height: '100%' }} ref={containerRef}>
          <div data-anchor="true" style={{ position: 'relative', minHeight: '100%' }}>
            <TwoWeeksView
              schedules={schedules}
              currentMonday={currentMonday}
              selectedTeacherId={selectedTeacherId}
              courses={courses}
              selectedCourseIds={selectedCourseIds}
              batchPhase={batchPhase}
              batchIsCopy={batchIsCopy}
              flashingIds={flashingIds}
              flashToggle={flashToggle}
              onDoubleClickDate={handleDoubleClickDate}
              onDoubleClickSchedule={handleDoubleClickSchedule}
              onScheduleStatusChange={handleScheduleStatusChange}
              onDropCourse={handleDropCourse}
              onDragSchedule={handleDragSchedule}
              onResizeSchedule={handleResizeSchedule}
              onDeleteSchedule={handleDeleteSchedule}
              onOpenStudentEdit={handleOpenStudentEdit}
            />
            {batchVisuals}
          </div>
        </div>
      </div>

      <Modal
        title="鎺掕绐楀彛"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setModalVisible(false)}>鍙栨秷</Button>,
          <Button key="save" type="primary" onClick={handleSave}>淇濆瓨</Button>,
        ]}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="鏃ユ湡">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {batchDates.map((d, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, width: 'calc(33.33% - 8px)' }}>
                  <DatePicker
                    style={{ flex: 1 }}
                    value={d}
                    onChange={(date) => {
                      if (date) {
                        const newDates = [...batchDates];
                        newDates[idx] = date;
                        setBatchDates(newDates);
                      }
                    }}
                  />
                  {batchDates.length > 1 && (
                    <Button type="text" danger icon="鉂? size="small"
                      onClick={() => {
                        const newDates = [...batchDates];
                        newDates.splice(idx, 1);
                        setBatchDates(newDates);
                      }}
                    />
                  )}
                </div>
              ))}
              <Button type="dashed" style={{ width: '100%' }}
                onClick={() => setBatchDates([...batchDates, batchDates[batchDates.length - 1] || dayjs()])}
              >鉃?娣诲姞鏃ユ湡</Button>
              <div style={{ fontSize: 12, color: '#666', width: '100%' }}>
                鍏?{batchDates.length} 鑺傝绋?              </div>
            </div>
          </Form.Item>
           
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="startTime" label="寮€濮嬫椂闂?>
                <TimePicker
                  format="HH:mm"
                  style={{ width: '100%' }}
                  onChange={(time) => {
                    if (time) {
                      const duration = form.getFieldValue('duration') || DEFAULT_DURATION_HOURS;
                      form.setFieldValue('endTime', time.add(duration, 'hour'));
                    }
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="duration" label="璇剧▼鏃堕暱">
                <Select
                  style={{ width: '100%' }}
                  onChange={(val) => {
                    const startTime = form.getFieldValue('startTime');
                    if (startTime) {
                      form.setFieldValue('endTime', startTime.add(val, 'hour'));
                    }
                  }}
                >
                  <Option value={0.5}>30鍒嗛挓</Option>
                  <Option value={1}>1灏忔椂</Option>
                  <Option value={1.5}>1.5灏忔椂</Option>
                  <Option value={2}>2灏忔椂</Option>
                  <Option value={2.5}>2.5灏忔椂</Option>
                  <Option value={3}>3灏忔椂</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="endTime" label="缁撴潫鏃堕棿">
                <TimePicker format="HH:mm" style={{ width: '100%' }} disabled />
              </Form.Item>
            </Col>
          </Row>
           
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="teacherId" label="鑰佸笀">
                <Select
                  placeholder="閫夋嫨鑰佸笀"
                  showSearch
                  allowClear
                  options={teachers.map(t => ({ label: t.name, value: t.id }))}
                  filterOption={(input, option) =>
                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  onChange={(val: string | undefined) => {
                    setModalTeacherId(val);
                    if (val) {
                      form.setFieldValue('courseId', undefined);
                    }
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="courseId" label="璇剧▼">
                <Select
                  placeholder="閫夋嫨璇剧▼"
                  options={courses
                    .filter(c => c.active && (!modalTeacherId || c.teacher_id === modalTeacherId))
                    .map(c => ({ label: c.display_name || c.name, value: c.id }))
                  }
                  onChange={(courseId) => {
                    const course = courses.find(c => c.id === courseId);
                    if (course) {
                      const displayCName = course.display_name || course.name.replace(/^\d{4}\s+\S+瀛︽湡\s+/, '');
                      form.setFieldValue('courseName', displayCName);
                      const roomId = (course.room_id && course.room_id.split(',')[0].trim()) || (rooms.find(r => r.name === course.room_name)?.id) || course.room_name || ''; form.setFieldValue('room', roomId);
                      if (course.default_duration_minutes) {
                        const durHours = course.default_duration_minutes / 60;
                        const durOptions = [0.5, 1, 1.5, 2, 2.5, 3];
                        const closest = durOptions.reduce((prev, curr) => Math.abs(curr - durHours) < Math.abs(prev - durHours) ? curr : prev);
                        form.setFieldValue('duration', closest);
                        const sTime = form.getFieldValue('startTime');
                        if (sTime) { form.setFieldValue('endTime', dayjs(sTime).add(course.default_duration_minutes, 'minute')); }
                      }
                    }
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="璇剧▼鐘舵€? initialValue={ScheduleStatus.PLANNED}>
                <Select>
                  <Option value={ScheduleStatus.PLANNED}>鉁?姝ｅ父</Option>
                  <Option value={ScheduleStatus.LEAVE}>馃彔 璇峰亣</Option>
                  <Option value={ScheduleStatus.CANCELLED}>鉂?鍙栨秷</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
           
          <Form.Item name="courseName" rules={[{ required: true }]} style={{ display: 'none' }}>
            <Input />
          </Form.Item>
           
          <Form.Item name="room" label="涓婅鍦板潃">
            <Select
              placeholder="閫夋嫨涓婅鍦板潃"
              showSearch
              allowClear
              options={rooms.map(r => ({ label: r.address ? `${r.name} (${r.address})` : r.name, value: r.id }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`瀛︾敓鍑哄嫟鍜岃垂鐢?- ${studentEditModal.schedule?.course_name || ''}`}
        open={studentEditModal.open}
        onCancel={() => setStudentEditModal({ open: false, schedule: null })}
        onOk={() => handleSaveStudentEdit()}
        width={700}
      >
        {studentEditModal.schedule && (
          <Form form={studentEditForm} layout="vertical">
            {(courseStudentPricings || []).map((sp, idx) => {
              const student = allStudents.find(s => s.id === sp.student_id);
              return (
                <Card
                  size="small"
                  key={sp.student_id}
                  title={`${idx+1}. ${student?.name || '鏈煡瀛︾敓'}`}
                  style={{ marginBottom: 12 }}
                >
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item
                        name={['students', idx, 'status']}
                        label="鍑哄嫟鐘舵€?
                        initialValue={sp.status || ScheduleStatus.PLANNED}
                      >
                        <Select>
                          <Option value={ScheduleStatus.PLANNED}>姝ｅ父鍑哄嫟</Option>
                          <Option value={ScheduleStatus.LEAVE}>璇峰亣</Option>
                          <Option value={ScheduleStatus.CANCELLED}>鍙栨秷</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item
                        name={['students', idx, 'tuition']}
                        label={`瀛﹁垂${billingUnitLabel}`}
                        initialValue={sp.tuition}
                      >
                        <InputNumber min={0} prefix="楼" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item
                        name={['students', idx, 'teacher_fee']}
                        label={`璇炬椂璐?{billingUnitLabel}`}
                        initialValue={sp.teacher_fee || sp.tuition}
                      >
                        <InputNumber min={0} prefix="楼" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              );
            })}
            {(!courseStudentPricings || courseStudentPricings.length === 0) && (
              <div style={{ textAlign: 'center', color: '#999', padding: 20 }}>
                璇ヨ绋嬫湭缁戝畾瀛︾敓淇℃伅
              </div>
            )}
          </Form>
        )}
      </Modal>

      <Modal
        title="鍒锋柊璇剧▼淇℃伅"
        open={refreshModalVisible}
        onCancel={() => { setRefreshModalVisible(false); setRefreshDateRange(null); }}
        onOk={handleRefreshCourseInfo}
        okText="寮€濮嬪埛鏂?
        cancelText="鍙栨秷"
      >
        <div style={{ marginBottom: 16 }}>
          <p>閫夋嫨鏃ユ湡鑼冨洿锛岀郴缁熷皢閬嶅巻璇ヨ寖鍥村唴鐨勬墍鏈夋帓璇撅紝閲嶆柊浠庤绋嬫暟鎹簱璇诲彇鏈€鏂颁俊鎭苟鏇存柊鎺掕璁板綍銆?/p>
          <p style={{ color: '#999', fontSize: 12 }}>鏇存柊瀛楁锛氳绋嬪悕绉般€佷笂璇惧湴鍧€銆佽€佸笀鍚嶇О銆佸鐢熷璐?璇炬椂璐?/p>
        </div>
        <Form layout="vertical">
          <Form.Item label="鏃ユ湡鑼冨洿" required>
            <DatePicker.RangePicker
              value={refreshDateRange as any}
              onChange={(dates) => setRefreshDateRange(dates as [Dayjs, Dayjs])}
              style={{ width: '100%' }}
              format="YYYY-MM-DD"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ScheduleCalendar;

