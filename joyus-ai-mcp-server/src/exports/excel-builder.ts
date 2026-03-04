import { spawn } from 'child_process';
import path from 'path';

import { WorkbookPayload } from './types.js';

interface BuildWorkbookInput {
  outputPath: string;
  workbook: WorkbookPayload;
}

interface BuilderResult {
  ok: boolean;
  path?: string;
  error?: string;
}

function pythonScriptPath(): string {
  return path.resolve(process.cwd(), 'scripts', 'export_workbook.py');
}

function pythonBinary(): string {
  return process.env.EXPORT_PYTHON_BIN || 'python3';
}

export async function buildWorkbookFile(input: BuildWorkbookInput): Promise<void> {
  const scriptPath = pythonScriptPath();
  const payload = JSON.stringify({
    output_path: input.outputPath,
    sheets: input.workbook.sheets,
  });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(pythonBinary(), [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to spawn workbook exporter: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Workbook exporter failed with code ${code}. ${stderr || stdout || 'No error output returned.'}`
          )
        );
        return;
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve();
        return;
      }

      try {
        const parsed = JSON.parse(trimmed) as BuilderResult;
        if (!parsed.ok) {
          reject(new Error(parsed.error || 'Workbook exporter reported failure.'));
          return;
        }
      } catch (error) {
        reject(
          new Error(`Workbook exporter returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
        );
        return;
      }

      resolve();
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}

