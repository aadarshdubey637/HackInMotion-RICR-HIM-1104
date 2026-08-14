'use client';

import { useRef, type ClipboardEvent, type KeyboardEvent, type ChangeEvent } from 'react';
import { cn } from '@/lib/utils';

/**
 * Six single-character boxes that behave as one field.
 *
 * The value is a plain string of up to six digits, held by the parent — the
 * boxes are a presentation of it, not six pieces of state that have to be kept
 * in step. Everything below exists because a farmer will reach this screen on a
 * phone, one-handed, reading the code off another app:
 *
 *   - Pasting the whole code into any box fills all six. Most people paste, and
 *     a paste that lands entirely in box 3 is the default browser behaviour.
 *   - Android keyboards often deliver a "replacement" rather than a keypress, so
 *     the change handler takes the last digit of whatever arrives instead of
 *     assuming one character.
 *   - Backspace in an empty box clears the one before it and moves there, which
 *     is what every other OTP field does and therefore what fingers expect.
 *   - `autoComplete="one-time-code"` lets the OS offer the code it saw, and
 *     `inputMode="numeric"` brings up the number pad rather than a full keyboard.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  describedBy,
  length = 6,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Fired when the last empty box is filled — lets the parent auto-submit. */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  length?: number;
}) {
  const boxes = useRef<Array<HTMLInputElement | null>>([]);

  function focusBox(index: number) {
    const clamped = Math.max(0, Math.min(length - 1, index));
    boxes.current[clamped]?.focus();
    boxes.current[clamped]?.select();
  }

  /** Write `digits` starting at `start`, then move focus and maybe complete. */
  function commit(digits: string, start: number) {
    const next = (value.slice(0, start) + digits + value.slice(start + digits.length))
      .replace(/\D/g, '')
      .slice(0, length);

    onChange(next);

    const landed = start + digits.length;
    focusBox(landed);

    if (next.length === length) onComplete?.(next);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>, index: number) {
    const digits = event.target.value.replace(/\D/g, '');
    if (!digits) return;

    // One box, one digit — unless this was a paste or an IME replacement, in
    // which case the extra digits spill into the boxes to the right.
    commit(digits.length > 1 ? digits : digits.slice(-1), index);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === 'Backspace') {
      event.preventDefault();

      if (value[index]) {
        onChange(value.slice(0, index) + value.slice(index + 1));
        return;
      }

      // Empty box: clear the previous digit and step back onto it.
      if (index > 0) {
        onChange(value.slice(0, index - 1) + value.slice(index));
        focusBox(index - 1);
      }
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusBox(index - 1);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusBox(index + 1);
    }
  }

  /**
   * Handled explicitly rather than left to `onChange`, because a paste into the
   * last box would otherwise be truncated to its final digit.
   */
  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!digits) return;

    event.preventDefault();
    onChange(digits);
    focusBox(digits.length);
    if (digits.length === length) onComplete?.(digits);
  }

  return (
    <div className="flex justify-center gap-2" role="group" aria-describedby={describedBy}>
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          // `text` with a numeric inputMode, not `number`: a number input shows
          // spinner arrows, accepts "e" and "-", and silently rejects a leading
          // zero in some browsers — and a code can legitimately start with one.
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          // The OS keyboard should not try to help with a random number.
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={length}
          value={value[index] ?? ''}
          disabled={disabled}
          aria-label={`Digit ${index + 1} of ${length}`}
          aria-invalid={invalid ? true : undefined}
          onChange={(event) => handleChange(event, index)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          onPaste={handlePaste}
          // Tapping a box that already holds a digit should replace it, not
          // append to it or drop the caret behind it.
          onFocus={(event) => event.currentTarget.select()}
          autoFocus={index === 0}
          className={cn(
            'h-14 w-11 rounded-xl border-2 bg-white text-center text-2xl font-bold tabular-nums text-slate-900',
            'focus:outline-none focus:ring-2 focus:ring-offset-1',
            'disabled:bg-slate-50 disabled:text-slate-400',
            invalid
              ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
              : 'border-soil-200 focus:border-brand-500 focus:ring-brand-500',
          )}
        />
      ))}
    </div>
  );
}
