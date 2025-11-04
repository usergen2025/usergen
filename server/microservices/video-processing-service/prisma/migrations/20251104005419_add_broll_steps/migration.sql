-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

-- Add BROLL_IMAGES if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'BROLL_IMAGES' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'VideoCreationStep')
    ) THEN
        ALTER TYPE "VideoCreationStep" ADD VALUE 'BROLL_IMAGES';
    END IF;
END $$;

-- Add BROLL_VIDEOS if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'BROLL_VIDEOS' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'VideoCreationStep')
    ) THEN
        ALTER TYPE "VideoCreationStep" ADD VALUE 'BROLL_VIDEOS';
    END IF;
END $$;
