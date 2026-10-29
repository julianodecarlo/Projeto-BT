import { useEffect, useState } from 'react';

interface MoneyInputProps {
  value: number | null;
  onValueChange: (value: number) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}

const numberFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Converte dígitos crus (centavos) em texto BRL: "123456" -> "1.234,56"
const format = (digits: string, neg: boolean): string => {
  if (!digits) return '';
  const value = Number(digits) / 100;
  return `${neg ? '-' : ''}${numberFormat.format(value)}`;
};

const isNegative = (v: number | null | undefined): boolean => v != null && v < 0;
const centsFrom = (v: number | null | undefined): string =>
  v != null && v !== 0 ? Math.round(Math.abs(v) * 100).toString() : '';

// Input monetário padrão BRL, sem spinners, com máscara em tempo real.
export function MoneyInput({
  value,
  onValueChange,
  className = '',
  placeholder = '0,00',
  disabled,
  onKeyDown,
  inputRef,
}: MoneyInputProps) {
  const [display, setDisplay] = useState<string>('');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDisplay(format(centsFrom(value), isNegative(value)));
    }
  }, [value, focused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const neg = e.target.value.trim().startsWith('-');
    const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '');
    setDisplay(format(digits, neg));
    if (!digits) {
      onValueChange(0);
      return;
    }
    const abs = parseInt(digits, 10) / 100;
    onValueChange(neg ? -abs : abs);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      ref={inputRef}
      value={display}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={onKeyDown}
      onChange={handleChange}
      className={`text-right border border-slate-300 rounded-md outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors ${className}`}
      placeholder={placeholder}
    />
  );
}
