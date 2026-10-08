-- Existing projects retain their customer-project behavior and reporting.
CREATE TYPE "ProjectCategory" AS ENUM ('CLIENT', 'INTERNAL');
ALTER TABLE "Project" ADD COLUMN "category" "ProjectCategory" NOT NULL DEFAULT 'CLIENT';
