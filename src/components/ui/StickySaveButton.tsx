import { Save } from 'lucide-react';
import { Button } from './Field';

interface StickySaveButtonProps {
  dirty?: boolean;
  disabled?: boolean;
  label?: string;
  onSave: () => void | Promise<void>;
}

export default function StickySaveButton({ dirty, disabled, label = 'Salvar', onSave }: StickySaveButtonProps) {
  return (
    <Button
      onClick={onSave}
      disabled={disabled}
      variant={dirty ? 'primary' : 'secondary'}
      size="sm"
      className={dirty ? 'ring-2 ring-blue-200' : ''}
    >
      <Save className="w-4 h-4" /> {label}
    </Button>
  );
}
