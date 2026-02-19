/**
 * Logging utility — T038
 *
 * Centralized logging with levels. All output goes to stderr.
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.DEBUG]: 'DEBUG',
};

let currentLevel: LogLevel = LogLevel.WARN;

// Initialize from environment
const envLevel = process.env.JOYUS_AI_LOG_LEVEL?.toUpperCase();
if (envLevel && envLevel in LogLevel) {
  currentLevel = LogLevel[envLevel as keyof typeof LogLevel] as unknown as LogLevel;
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function logError(message: string, error?: Error): void {
  if (currentLevel < LogLevel.ERROR) return;
  console.error(`[joyus-ai] [ERROR] ${message}`);
  if (error && currentLevel >= LogLevel.DEBUG) {
    console.error(error.stack);
  }
}

export function logWarn(message: string): void {
  if (currentLevel < LogLevel.WARN) return;
  console.error(`[joyus-ai] [WARN] ${message}`);
}

export function logInfo(message: string): void {
  if (currentLevel < LogLevel.INFO) return;
  console.error(`[joyus-ai] [INFO] ${message}`);
}

export function logDebug(message: string): void {
  if (currentLevel < LogLevel.DEBUG) return;
  console.error(`[joyus-ai] [DEBUG] ${message}`);
}
