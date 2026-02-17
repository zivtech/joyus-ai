/**
 * Prisma Client Type Stub
 *
 * This file provides type stubs when Prisma client hasn't been generated yet.
 * In production, the actual @prisma/client types will be used.
 */

declare module '@prisma/client' {
  export interface PrismaClient {
    user: any;
    connection: any;
    auditLog: any;
    oAuthState: any;
    scheduledTask: any;
    taskRun: any;
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
  }

  export const PrismaClient: new (options?: any) => PrismaClient;
}
