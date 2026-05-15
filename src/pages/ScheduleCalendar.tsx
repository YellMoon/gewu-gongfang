import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Modal, Form, Input, InputNumber, Select, DatePicker, TimePicker, Calendar, Divider, Card, Row, Col, Button, message, Space, Dropdown, Alert
} from 'antd';
import type { MenuProps } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { CourseType, ScheduleStatus, Course, Teacher, Student, BillingUnit } from '../types';
import useBatchSelection from './useBatchSelection';
import AutoCloseSelect from '../components/AutoCloseSelect';
import { v4 as uuidv4 } from 'uuid';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import isoWeek from 'dayjs/plugin/isoWeek';
import { holidays2026, getUpcomingHolidays } from '../utils/helpers';

dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);


const { Option } = Select;

const MIN_START_HOUR = 8;
const MAX_END_HOUR = 23;
const SLOT_DURATION = 5;
const SLOT_HEIGHT = 2.5;
const COLUMN_WIDTH = 140;
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

  const effectiveMaxEndSlot = ((maxHour - MIN_START_HOUR) * 60) / SLOT_DURATION;
  const earlyOffset = minHour < MIN_START_HOUR ? ((MIN_START_HOUR - minHour) * 60 / SLOT_DURATION * SLOT_HEIGHT) : 0;
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
      // Ctrl+鎷栨嫿锛堝鍒讹級锛氬師课程妗嗕綅缃浐瀹氫笉鍔紝鍙湁铏氬奖璺熼殢榧犳爣
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
      const slotDiff = Math.round((dragState.currentY - dragState.startY) / SLOT_HEIGHT);
        
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
    label: '删除课程',
    danger: true,
    onClick: () => { onDeleteSchedule?.(schedule.id); }
  },
  { type: 'divider' },
  {
    key: 'normal',
    label: '设为正常',
    disabled: schedule.status === ScheduleStatus.PLANNED,
    onClick: () => onScheduleStatusChange(schedule.id, ScheduleStatus.PLANNED)
  },
  {
    key: 'leave',
    label: '设为请假',
    disabled: schedule.status === ScheduleStatus.LEAVE,
    onClick: () => onScheduleStatusChange(schedule.id, ScheduleStatus.LEAVE)
  },
  {
    key: 'cancelled',
    label: '设为取消',
    disabled: schedule.status === ScheduleStatus.CANCELLED,
    onClick: () => onScheduleStatusChange(schedule.id, ScheduleStatus.CANCELLED)
  },
  { type: 'divider' },
  {
    key: 'student-edit',
    label: '学生出勤和费用',
    onClick: () => onOpenStudentEdit?.(schedule)
  }
];

  const weekDayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

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
        <div>{weekDayLabels[dayIndex]}{isHoliday ? ` (${holidayName})` : ''}</div>
        <div style={{ fontSize: 12, fontWeight: 'normal', marginTop: 2 }}>
          {day.format('M月D日')}
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
          if (lineTop >= maxEndSlot * SLOT_HEIGHT) return null;
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

        {/* 鎷栧叆课程棰勮 */}
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
                {dragCourse ? (dragCourse.display_name || dragCourse.name.replace(/^\d{4}\s+\S+学期\s+/, '')) : '课程'}
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
          if (batchPhase === 'dragging' && !batchIsCopy && selectedCourseIds.includes(schedule.id)) return null;
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
                  {/* 课程妗嗗唴瀹硅嚜閫傚簲灞呬腑 */}
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
                        const isCtrlDrag = dragState.ctrlKey;
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
          {/* 鈶?涓よ甯冨眬锛屽拰鐪熷疄课程妗嗗畬鍏ㄤ竴鑷达細课程鍚?+ 涓婅鍦板潃&璧锋鏃堕棿 */}
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

  const weekDateStr = startMonday.format('YYYY-MM-DD');
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
        {weekLabel}: {startMonday.format('M月D日')} ~ {startMonday.add(6, 'day').format('M月D日')}
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
    if (!selectedTeacherId) return false; // 鈶?娌℃湁閫変腑鑰佸笀鏃朵笉鏄剧ず浠讳綍课程
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
    const img = new Image();
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
          <h4 style={{ margin: '0 0 8px 0' }}>选择老师</h4>
          <Select
            style={{ width: '100%', marginBottom: 8 }}
            placeholder="选择老师"
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
            未结课程 ({filteredCourses.length})
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
              {course.display_name || course.name.replace(/^\d{4}\s+\S+学期\s+/, '')}
            </div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>
              {course.year || course.name?.match(/^(\d{4})/)?.[1] || '-'} 年{' '}
              {course.semester || course.name?.match(/^\d{4}\s+(\S+学期)/)?.[1] || '-'}
            </div>
            {course.type !== undefined && (
              <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>
                {course.room_name && `${course.room_name} `}{course.type === CourseType.ONE_ON_ONE ? '一对一' : course.type === CourseType.ONE_ON_TWO ? '一对二' : '班课'}
              </div>
            )}
          </div>
        ))}
        {filteredCourses.length === 0 && (
          <div style={{ textAlign: 'center', color: '#999', padding: '20px 0', fontSize: 14 }}>
            暂无未结课程
          </div>
        )}
          </div>
        </div>
      )}
      {!selectedTeacherId && teachers.length > 0 && (
        <div style={{ textAlign: 'center', color: '#999', padding: '40px 0', fontSize: 14 }}>
          请先选择老师
        </div>
      )}
    </div>
  );
};

const ScheduleCalendar: React.FC = () => {
  const [schedules, setSchedules] = useState<ScheduleEvent[]>([]);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const today = dayjs();
  let initialMonday = today.startOf('isoWeek');
  const [currentMonday, setCurrentMonday] = useState<Dayjs>(initialMonday);
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

  const MAX_HISTORY = 10;
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
      const isChanged = JSON.stringify(newSchedules) !== JSON.stringify(prev);
      if (isChanged) {
        setHistory(h => ({
          past: [...h.past.slice(-(MAX_HISTORY - 1)), [...prev]],
          future: [],
        }));
      }
      return newSchedules;
    });
  }, []);

  // 鎵归噺閫夋嫨鎷栨嫿锛堜娇鐢ㄥ巻鍙插寘瑁呭洖璋冿級
  const { batchVisuals, phase: batchPhase, selectedCourseIds, isCopy: batchIsCopy, flashingIds, flashToggle, setSchedules: setBatchSchedules, setCourses: setBatchCourses } = useBatchSelection(containerRef, currentMonday, setSchedulesWithHistory, (ids: string[]) => {
    // 鎵归噺鍒犻櫎鍥炶皟锛氫粠schedules涓Щ闄ゆ寚瀹欼D鐨勮绋嬶紝骞惰鍏ュ巻鍙?    setSchedulesWithHistory(prev => prev.filter(s => !ids.includes(s.id)));
    message.success(`已删除 ${ids.length} 节课程`);
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

  // Ctrl+Z / Ctrl+Y 快捷键
  React.useEffect(() => {
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
              // 鍚屾课程鍚嶇О锛堝彧鏄剧ず绾绋嬪悕锛屼笉鍚勾浠藉鏈燂級
              const displayCourseName = course.display_name || course.name.replace(/^\d{4}\s+\S+学期\s+/, '');
              if (displayCourseName && s.course_name !== displayCourseName) {
                updated.course_name = displayCourseName;
              }
              const courseYear = course.year !== undefined ? String(course.year) : undefined;
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

  // 当前课程的计费单位
  const billingCourse = studentEditModal.schedule
    ? courses.find(c => c.id === (studentEditModal.schedule as any).course_id)
    : null;
  const billingUnitLabel = (() => {
    const buRaw = (billingCourse as any)?.billing_unit;
    const bu = buRaw !== undefined && buRaw !== null ? Number(buRaw) : null;
    if (bu === BillingUnit.PER_HOUR) return '/小时';
    if (bu === BillingUnit.PER_SESSION) return '/次';
    return '/次';
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
        const db = (window as any).dbService;
        if (db?.updateCourse) {
          db.updateCourse(course.id, { student_pricings: updatedPricings });
        }
        message.success('学生信息修改成功');
        setStudentEditModal({ open: false, schedule: null });
      }
    }
  }

  function handleScheduleStatusChange(id: string, status: ScheduleStatus) {
    const changedSchedule = schedules.find(s => s.id === id);
    setSchedulesWithHistory(prev => prev.map(s => s.id === id ? { ...s, status } : s));
    message.success('状态已更新');
    if (changedSchedule) {
      const statusLabels: Record<string, string> = {
        [ScheduleStatus.PLANNED]: '正常',
        [ScheduleStatus.COMPLETED]: '已完成',
        [ScheduleStatus.LEAVE]: '请假',
        [ScheduleStatus.CANCELLED]: '取消',
      };
      (window as any).operateLogger?.log('修改', `修改排课「${changedSchedule.course_name}」状态为「${statusLabels[status] || status}」`, '课程表');
    }
  }

  function handleDropCourse(course: Course, day: Dayjs, slot: number) {
    // 课程琛ㄥ彧鏄剧ず绾绋嬪悕
    const displayCourseName = course.display_name || course.name.replace(/^\d{4}\s+\S+学期\s+/, '');
    const { hour: startH, minute: startM } = slotToTime(slot);
    const startTime = dayjs(day).hour(startH).minute(startM).second(0);
    // 有默认时长：直接创建课程框，不弹窗
    if (course.default_duration_minutes) {
      const endTime = startTime.add(course.default_duration_minutes, 'minute');
      const overlap = checkOverlap('', startTime.format('YYYY-MM-DD HH:mm'), endTime.format('YYYY-MM-DD HH:mm'));
      if (overlap) {
        message.warning(`与「${overlap.course_name}」时间冲突，请调整位置`);
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
      message.success(`已添加「${displayCourseName}」(${startTime.format('HH:mm')}-${endTime.format('HH:mm')})`);
      (window as any).operateLogger?.log('创建', `创建排课「${displayCourseName}」(${startTime.format('YYYY-MM-DD HH:mm')}-${endTime.format('YYYY-MM-DD HH:mm')})`, '课程表');
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
    
    if (!ctrlKey) {
      const overlap = checkOverlap(schedule.id, newStartTimeStr, newEndTimeStr);
      if (overlap) {
        message.warning(`时间重叠：与「${overlap.course_name}」(${overlap.start_time.substring(11,16)}-${overlap.end_time.substring(11,16)})冲突，已恢复`);
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
      message.success('课程已复制');
      (window as any).operateLogger?.log('复制', `复制排课「${schedule.course_name}」到 ${newStartTimeStr.substring(0,10)} ${newStartTimeStr.substring(11,16)}-${newEndTimeStr.substring(11,16)}`, '课程表');
    } else {
      setSchedulesWithHistory(prev => prev.map(s => 
        s.id === schedule.id 
          ? { ...s, start_time: newStartTimeStr, end_time: newEndTimeStr }
          : s
      ));
      message.success('课程已移动');
      (window as any).operateLogger?.log('移动', `移动排课「${schedule.course_name}」到 ${newStartTimeStr.substring(0,10)} ${newStartTimeStr.substring(11,16)}-${newEndTimeStr.substring(11,16)}`, '课程表');
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
    
    const overlap = checkOverlap(schedule.id, newStartTime, newEndTime);
    if (overlap) {
      message.warning(`时间重叠：与「${overlap.course_name}」(${overlap.start_time.substring(11,16)}-${overlap.end_time.substring(11,16)})冲突，已恢复`);
      return;
    }
    
    setSchedulesWithHistory(prev => prev.map(s => 
      s.id === schedule.id 
        ? { ...s, start_time: newStartTime, end_time: newEndTime }
        : s
    ));
    message.success('课程时间已调整');
  }

  function handleDeleteSchedule(id: string) {
    if (window.confirm('确定要删除这节课程吗？')) {
      const deletedSchedule = schedules.find(s => s.id === id);
      setSchedulesWithHistory(prev => prev.filter(s => s.id !== id));
      message.success('课程已删除');
      if (deletedSchedule) {
        (window as any).operateLogger?.log('删除', `删除排课「${deletedSchedule.course_name}」`, '课程表');
      }
    }
  }

  function handleSave() {
    const values = form.getFieldsValue();
    if (!values.startTime) { message.warning('请选择开始时间'); return; }
    if (!values.duration) { message.warning('请选择课程时长'); return; }
    if (!values.teacherId) { message.warning('请选择老师'); return; }
    if (!values.courseId) { message.warning('请选择课程'); return; }
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
        
        const eId = editingSchedule?.id || '';
        const overlap = checkOverlap(eId, startTimeStr, endTimeStr);
        if (overlap) {
          message.warning(`时间重叠：${dateStr} 与「${overlap.course_name}」(${overlap.start_time.substring(11,16)}-${overlap.end_time.substring(11,16)})冲突，已恢复`);
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
          (window as any).operateLogger?.log('修改', `修改排课「${courseName}」时间 ${startTimeStr.substring(11,16)}-${endTimeStr.substring(11,16)}`, '课程表');
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
        const logDetail = `批量创建排课：${datesToSave.length} 节 - ${newSchedules.map(s => s.course_name.split(' ')[0]).filter(Boolean).join(', ')}`;
        (window as any).operateLogger?.log('创建', logDetail, '课程表');
      }
      
      const msg = datesToSave.length > 1 ? `已添加 ${datesToSave.length} 节课程` : '课程已保存';
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
      message.warning('请选择日期范围');
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
      const displayCName = course.display_name || course.name.replace(/^\d{4}\s+\S+学期\s+/, '');
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
    message.success(`已更新 ${count} 条课程信息`);
    setRefreshModalVisible(false);
    setRefreshDateRange(null);
  }

  const upcomingHolidays = getUpcomingHolidays();

  return (
    <div style={{ padding: 16, height: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}>
      <Card size="small" style={{ marginBottom: 8, flexShrink: 0 }}>
        <Space wrap>
          <Button onClick={goPrevWeek}>上一周</Button>
          <Button onClick={goToday}>本周</Button>
          <Button onClick={goNextWeek}>下一周</Button>
          <Button 
            onClick={() => setCalendarOpen(!calendarOpen)}
            title="点击跳转到选定日期的课程表"
          >
            选择日期
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
            title="撤销 (Ctrl+Z)"
          >撤销</Button>
          <Button 
            onClick={redo} 
            disabled={history.future.length === 0}
            title="重做 (Ctrl+Y)"
          >重做</Button>
          <Divider type="vertical" />
          <Button 
            onClick={() => {
              setRefreshDateRange([currentMonday, currentMonday.add(13, 'day')]);
              setRefreshModalVisible(true);
            }}
            title="刷新日期范围内所有排课的课程信息"
          >
            刷新课程信息
          </Button>
          <Divider type="vertical" />
          <Button type="primary" onClick={handleAddSchedule}>排课</Button>
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
        title="排课窗口"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setModalVisible(false)}>取消</Button>,
          <Button key="save" type="primary" onClick={handleSave}>保存</Button>,
        ]}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="日期">
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
                    <Button type="text" danger size="small"
                      onClick={() => {
                        const newDates = [...batchDates];
                        newDates.splice(idx, 1);
                        setBatchDates(newDates);
                      }}
                    >删除</Button>
                  )}
                </div>
              ))}
              <Button type="dashed" style={{ width: '100%' }}
                onClick={() => setBatchDates([...batchDates, batchDates[batchDates.length - 1] || dayjs()])}
              >添加日期</Button>
              <div style={{ fontSize: 12, color: '#666', width: '100%' }}>
                共 {batchDates.length} 节课程
              </div>
            </div>
          </Form.Item>
           
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="startTime" label="开始时间">
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
              <Form.Item name="duration" label="课程时长">
                <AutoCloseSelect
                  style={{ width: '100%' }}
                  onChange={(val: number) => {
                    const startTime = form.getFieldValue('startTime');
                    if (startTime) {
                      form.setFieldValue('endTime', startTime.add(val, 'hour'));
                    }
                  }}
                  options={[
                    { value: 0.5, label: '30分钟' },
                    { value: 1, label: '1小时' },
                    { value: 1.5, label: '1.5小时' },
                    { value: 2, label: '2小时' },
                    { value: 2.5, label: '2.5小时' },
                    { value: 3, label: '3小时' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="endTime" label="结束时间">
                <TimePicker format="HH:mm" style={{ width: '100%' }} disabled />
              </Form.Item>
            </Col>
          </Row>
           
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="teacherId" label="老师">
                <AutoCloseSelect
                  placeholder="选择老师"
                  showSearch
                  allowClear
                  options={teachers.map(t => ({ label: t.name, value: t.id }))}
                  filterOption={(input: string, option: any) =>
                    String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  onChange={(val: string | undefined) => {
                    setModalTeacherId(val);
                    form.setFieldValue('courseId', undefined);
                    form.setFieldValue('courseName', undefined);
                    form.setFieldValue('room', undefined);
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="courseId" label="课程">
                <AutoCloseSelect
                  placeholder={modalTeacherId ? '选择课程' : '请先选择老师'}
                  disabled={!modalTeacherId}
                  showSearch
                  options={courses
                    .filter(c => c.active && !!modalTeacherId && String(c.teacher_id) === String(modalTeacherId))
                    .map(c => ({ label: c.display_name || c.name, value: c.id }))
                  }
                  filterOption={(input: string, option: any) =>
                    String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  onChange={(courseId: string) => {
                    const course = courses.find(c => c.id === courseId);
                    if (course) {
                      const displayCName = course.display_name || course.name.replace(/^\d{4}\s+\S+学期\s+/, '');
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
              <Form.Item name="status" label="课程状态" initialValue={ScheduleStatus.PLANNED}>
                <AutoCloseSelect
                  options={[
                    { value: ScheduleStatus.PLANNED, label: '正常' },
                    { value: ScheduleStatus.LEAVE, label: '请假' },
                    { value: ScheduleStatus.CANCELLED, label: '取消' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
           
          <Form.Item name="courseName" rules={[{ required: true }]} style={{ display: 'none' }}>
            <Input />
          </Form.Item>
           
          <Form.Item name="room" label="上课地址">
            <AutoCloseSelect
              placeholder="选择上课地址"
              showSearch
              allowClear
              options={rooms.map(r => ({ label: r.address ? `${r.name} (${r.address})` : r.name, value: r.id }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`学生出勤和费用 - ${studentEditModal.schedule?.course_name || ''}`}
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
                  title={`${idx + 1}. ${student?.name || '未知学生'}`}
                  style={{ marginBottom: 12 }}
                >
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item
                        name={['students', idx, 'status']}
                        label="出勤状态"
                        initialValue={sp.status || ScheduleStatus.PLANNED}
                      >
                        <Select>
                          <Option value={ScheduleStatus.PLANNED}>正常出勤</Option>
                          <Option value={ScheduleStatus.LEAVE}>请假</Option>
                          <Option value={ScheduleStatus.CANCELLED}>取消</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item
                        name={['students', idx, 'tuition']}
                        label={`学费${billingUnitLabel}`}
                        initialValue={sp.tuition}
                      >
                        <InputNumber min={0} prefix="¥" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item
                        name={['students', idx, 'teacher_fee']}
                        label={`课时费${billingUnitLabel}`}
                        initialValue={sp.teacher_fee || sp.tuition}
                      >
                        <InputNumber min={0} prefix="¥" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              );
            })}
            {(!courseStudentPricings || courseStudentPricings.length === 0) && (
              <div style={{ textAlign: 'center', color: '#999', padding: 20 }}>
                该课程未绑定学生信息
              </div>
            )}
          </Form>
        )}
      </Modal>

      <Modal
        title="刷新课程信息"
        open={refreshModalVisible}
        onCancel={() => { setRefreshModalVisible(false); setRefreshDateRange(null); }}
        onOk={handleRefreshCourseInfo}
        okText="开始刷新"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <p>选择日期范围，系统将遍历该范围内的所有排课，重新从课程数据库读取最新信息并更新排课记录。</p>
          <p style={{ color: '#999', fontSize: 12 }}>更新字段：课程名称、上课地址、老师名称、学生学费、课时费</p>
        </div>
        <Form layout="vertical">
          <Form.Item label="日期范围" required>
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



