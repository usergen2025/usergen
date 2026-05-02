'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DayPicker, DayFlag, SelectionState, UI } from 'react-day-picker';
import { format, isAfter, isBefore, parse } from 'date-fns';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { createPortal } from 'react-dom';
import 'react-day-picker/style.css';

export interface BrandDatePickerProps {
  id?: string;
  /** ISO-style local date string `yyyy-MM-dd` */
  value: string;
  onChange: (nextYmd: string) => void;
  minDate?: Date;
  maxDate?: Date;
  placeholder?: string;
  disabled?: boolean;
}

function parseYmd(value: string): Date | undefined {
  if (!value?.trim()) return undefined;
  try {
    const d = parse(value.trim(), 'yyyy-MM-dd', new Date());
    return Number.isNaN(d.getTime()) ? undefined : d;
  } catch {
    return undefined;
  }
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function BrandDatePicker({
  id,
  value,
  onChange,
  minDate,
  maxDate,
  placeholder = 'Select date',
  disabled,
}: BrandDatePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<{
    top: number;
    left: number;
    placement: 'top' | 'bottom';
    viewportHeight: number;
  } | null>(null);

  const positionPopover = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const popoverHeight = 320;
    const popoverWidth = 304;
    const viewportHeight = window.innerHeight;
    const margin = 8;
    const shouldPlaceTop = rect.bottom + popoverHeight + margin > viewportHeight && rect.top > popoverHeight + margin;
    const placement: 'top' | 'bottom' = shouldPlaceTop ? 'top' : 'bottom';
    const top = shouldPlaceTop ? rect.top - margin : rect.bottom + margin;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8));
    setPopoverStyle({ top, left, placement, viewportHeight });
  };

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const targetNode = e.target as Node;
      if (
        !rootRef.current?.contains(targetNode) &&
        !popoverRef.current?.contains(targetNode)
      ) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selected = useMemo(() => parseYmd(value), [value]);

  useEffect(() => {
    if (!open) return;
    positionPopover();
    const onReposition = () => positionPopover();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  const disabledDates = useMemo(() => {
    return (date: Date) => {
      if (minDate && isBefore(date, stripTime(minDate))) return true;
      if (maxDate && isAfter(date, stripTime(maxDate))) return true;
      return false;
    };
  }, [minDate, maxDate]);

  const label = selected ? format(selected, 'd MMM yyyy') : '';

  return (
    <div ref={rootRef} id={id} className="relative">
      <div className="brand-field-shell">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => !disabled && setOpen((o) => !o)}
          className={cn(
            'brand-field-shell__input flex-1 cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-60',
            !selected && 'text-[#9E9E9E]',
          )}
        >
          {selected ? label : placeholder}
        </button>
        <span className="brand-field-shell__suffix pointer-events-none text-[#9E9E9E]">
          <Calendar className="h-4 w-4" aria-hidden />
        </span>
      </div>

      {open && popoverStyle ? createPortal(
        <div
          ref={popoverRef}
          className="brand-date-picker-popover fixed z-[220] rounded-2xl border border-[#DED4CB] bg-white p-2 shadow-[0_10px_28px_-12px_rgba(15,8,43,0.35)]"
          style={{
            top: popoverStyle.placement === 'bottom' ? popoverStyle.top : undefined,
            bottom: popoverStyle.placement === 'top' ? popoverStyle.viewportHeight - popoverStyle.top : undefined,
            left: popoverStyle.left,
            width: 304,
          }}
          role="dialog"
          aria-label="Choose date"
        >
          <DayPicker
            mode="single"
            required={false}
            selected={selected}
            onSelect={(d) => {
              if (!d) return;
              onChange(toYmd(d));
              setOpen(false);
            }}
            disabled={disabledDates}
            showOutsideDays
            className="brand-day-picker"
            classNames={{
              [UI.Root]: 'brand-day-picker__root rdp-root',
              [UI.Months]: 'brand-day-picker__months rdp-months',
              [UI.Month]: 'brand-day-picker__month rdp-month',
              [UI.MonthCaption]: 'brand-day-picker__caption rdp-month_caption',
              [UI.CaptionLabel]:
                'brand-day-picker__caption font-heading text-sm font-semibold text-[#212121]',
              [UI.Nav]: 'brand-day-picker__nav rdp-nav',
              [UI.PreviousMonthButton]:
                'brand-day-picker__nav-btn rdp-button_previous rounded-full p-1.5 text-[#E86512] hover:bg-orange-50',
              [UI.NextMonthButton]:
                'brand-day-picker__nav-btn rdp-button_next rounded-full p-1.5 text-[#E86512] hover:bg-orange-50',
              [UI.Weekdays]: 'brand-day-picker__weekdays rdp-weekdays',
              [UI.Weekday]:
                'brand-day-picker__weekday rdp-weekday text-center text-[0.65rem] font-medium uppercase tracking-wide text-[#9E9E9E]',
              [UI.Weeks]: 'brand-day-picker__weeks rdp-weeks',
              [UI.Week]: 'brand-day-picker__week rdp-week',
              [UI.Day]: 'brand-day-picker__day rdp-day',
              [UI.DayButton]:
                'brand-day-picker__day-btn rdp-day_button mx-auto flex h-9 w-9 items-center justify-center rounded-full font-heading text-sm text-[#212121] hover:bg-orange-50',
              [SelectionState.selected]:
                'brand-day-picker__selected text-white hover:text-white [&_button]:bg-gradient-to-br [&_button]:from-[#E86412] [&_button]:to-[#F12A4C] [&_button]:shadow-sm',
              [DayFlag.today]: 'brand-day-picker__today font-semibold text-[#E86512]',
              [DayFlag.disabled]: 'brand-day-picker__disabled opacity-35',
              [DayFlag.outside]: 'brand-day-picker__outside opacity-40',
            }}
          />
        </div>
      , document.body) : null}
    </div>
  );
}

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
