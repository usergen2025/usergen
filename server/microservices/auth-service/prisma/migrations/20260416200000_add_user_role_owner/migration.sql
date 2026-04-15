-- Owner role for platform administration (seed: owner@usergen.ai)
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OWNER';
