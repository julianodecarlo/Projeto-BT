import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefCallback } from 'react';

interface MoneyInputProps {
  value: number | null;
  onValueChange: (v: number | null) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: RefCallback<HTMLInputElement>;
  id?: string;
}

// Máscara BRL: exibe formatado quando desfocado, texto livre enquanto digita.
// Emite número a cada digitação; no blur apenas reformatar (sem reemitir valor
// igual), para nunca apagar o que foi digitado.
export function MoneyInput({
  value, onValueChange, className = '', placeholder = '0,00', disabled, onKeyDown, inputRef, id,
}: MoneyInputProps) {
  const format = (n: number | null) =>
    n == null || isNaN(n) ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const [text, setText] = useState(() => format(value));
  const [focused, setFocused] = useState(false);
  const lastEmitted = useRef<number | null>(value ?? null);

  useEffect(() => {
    if (!focused) setText(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  const parse = (s: string): number | null => {
    const clean = s.replace(/R\$/g, '').replace(/\s/g, '').trim();
    if (!clean) return null;
    if (!/^[\d.,]+$/.test(clean)) return null;
    const normalized = clean.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(normalized);
    return isNaN(n) ? null : n;
  };

  return (
    <input
      id={id}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        const raw = e.target.value;
        if (!/^[\d.,]*$/.test(raw)) return;
        setText(raw);
        const n = parse(raw);
        lastEmitted.current = n;
        onValueChange(n);
      }}
      onBlur={() => {
        setFocused(false);
        const n = parse(text);
        const out = n == null ? null : Math.round(n * 100) / 100;
        setText(format(out));
        if (out !== lastEmitted.current) {
          lastEmitted.current = out;
          onValueChange(out);
        }
      }}
      onKeyDown={onKeyDown}
    />
  );
}

export default MoneyInput;
