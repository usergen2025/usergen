-- Add VIDEO_TRANSLATION to OperationType enum (pricing + generation cost snapshots)
ALTER TYPE "OperationType" ADD VALUE IF NOT EXISTS 'VIDEO_TRANSLATION';
