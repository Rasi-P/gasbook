import { useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type SelectOption<T extends string | number> = { value: T; label: string };

/**
 * Custom dropdown (moved verbatim from pages/Stock.tsx). Opens upward when there is no room below.
 * Same props and behaviour as before; only its home changed.
 */
export function AppSelect<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  const handleOpen = () => {
    setOpen((current) => {
      if (!current && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        setOpenUp(spaceBelow < 220);
      }
      return !current;
    });
  };

  return (
    <div className="app-select" onBlur={() => setOpen(false)}>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-label={ariaLabel}
        className="app-select-trigger"
        onClick={handleOpen}
        type="button"
      >
        <span>{selected?.label ?? 'Select'}</span>
        <ChevronDown size={18} />
      </button>
      {open && (
        <div className={`app-select-menu ${openUp ? 'open-up' : ''}`} role="listbox">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                aria-selected={isSelected}
                className={isSelected ? 'selected' : ''}
                key={option.value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                <span>{option.label}</span>
                {isSelected && <Check size={16} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
