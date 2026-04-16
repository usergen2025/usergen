'use client';

import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
  variant?: 'danger' | 'default';
}

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isLoading = false,
  variant = 'default',
}: ConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="p-5 space-y-5">
        <p className="text-sm text-[#574977] leading-6">{description}</p>
        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isLoading}
            className="!px-4 !py-2"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === 'danger' ? 'primary' : 'secondary'}
            size="sm"
            onClick={onConfirm}
            disabled={isLoading}
            className={variant === 'danger' ? '!from-[#E03A3A] !to-[#C81D47] !px-4 !py-2' : '!px-4 !py-2'}
          >
            {isLoading ? 'Please wait...' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
