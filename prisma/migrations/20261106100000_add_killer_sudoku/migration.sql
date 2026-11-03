ALTER TABLE "SudokuGame" ADD COLUMN "variant" TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE "SudokuGame" ADD COLUMN "cages" JSONB;
