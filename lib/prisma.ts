import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Luôn cache client trên globalThis — kể cả ở production. Trên Vercel serverless,
// mỗi lần "warm" (container được tái sử dụng) sẽ dùng lại đúng client này thay vì
// tạo client mới + mở kết nối Postgres mới, giảm độ trễ đáng kể mỗi request.
export const prisma = globalForPrisma.prisma ?? new PrismaClient();

globalForPrisma.prisma = prisma;
