import { spawn, execSync, ChildProcess } from 'child_process';
import { ConfigService } from '@nestjs/config';

export interface FFmpegOptions {
  timeout?: number; // Timeout in milliseconds
  stdio?: 'inherit' | 'pipe' | 'ignore';
  encoding?: BufferEncoding;
  maxBuffer?: number;
}

export interface FFmpegResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: Error;
}

/**
 * FFmpeg Resource Manager
 * Wraps FFmpeg execution with resource limits to prevent false crypto-mining detection
 */
export class FFmpegResourceManager {
  private readonly maxThreads: number;
  private readonly nicePriority: number;
  private readonly useNice: boolean;
  private readonly useIonice: boolean;
  private readonly defaultTimeout: number;

  constructor(configService?: ConfigService) {
    // Get configuration from environment variables or use defaults
    this.maxThreads = parseInt(
      configService?.get<string>('FFMPEG_MAX_THREADS') ||
        process.env.FFMPEG_MAX_THREADS ||
        '4',
      10
    );
    this.nicePriority = parseInt(
      configService?.get<string>('FFMPEG_NICE_PRIORITY') ||
        process.env.FFMPEG_NICE_PRIORITY ||
        '10',
      10
    );
    this.useNice =
      configService?.get<string>('FFMPEG_USE_NICE') === 'true' ||
      process.env.FFMPEG_USE_NICE === 'true' ||
      true; // Default to true
    this.useIonice =
      configService?.get<string>('FFMPEG_USE_IONICE') === 'true' ||
      process.env.FFMPEG_USE_IONICE === 'true' ||
      true; // Default to true
    this.defaultTimeout = parseInt(
      configService?.get<string>('FFMPEG_TIMEOUT_MS') ||
        process.env.FFMPEG_TIMEOUT_MS ||
        '1800000', // 30 minutes
      10
    );
  }

  /**
   * Build FFmpeg command with resource limits
   */
  private buildFFmpegCommand(command: string): string[] {
    const parts = command.trim().split(/\s+/);
    
    // Extract ffmpeg and its arguments
    let ffmpegIndex = -1;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === 'ffmpeg' || parts[i].includes('ffmpeg')) {
        ffmpegIndex = i;
        break;
      }
    }

    if (ffmpegIndex === -1) {
      // If ffmpeg not found, assume it's a full command string
      // Parse it differently
      return this.parseCommandString(command);
    }

    // Check if -threads is already present
    let hasThreads = false;
    for (let i = ffmpegIndex; i < parts.length; i++) {
      if (parts[i] === '-threads') {
        hasThreads = true;
        // Update existing threads value
        if (i + 1 < parts.length) {
          parts[i + 1] = this.maxThreads.toString();
        }
        break;
      }
    }

    // Add -threads if not present (insert after ffmpeg)
    if (!hasThreads) {
      parts.splice(ffmpegIndex + 1, 0, '-threads', this.maxThreads.toString());
    }

    // Build final command with nice/ionice
    const finalCommand: string[] = [];
    
    if (this.useIonice) {
      finalCommand.push('ionice', '-c', '3');
    }
    
    if (this.useNice) {
      finalCommand.push('nice', '-n', this.nicePriority.toString());
    }
    
    finalCommand.push(...parts);

    return finalCommand;
  }

  /**
   * Parse command string and add resource limits
   */
  private parseCommandString(command: string): string[] {
    // Remove extra whitespace
    const cleaned = command.replace(/\s+/g, ' ').trim();
    
    // Check if command already has -threads
    if (cleaned.includes('-threads')) {
      // Replace existing threads value
      const threadRegex = /-threads\s+\d+/;
      const newCommand = cleaned.replace(threadRegex, `-threads ${this.maxThreads}`);
      return this.wrapCommand(newCommand);
    }

    // Find where to insert -threads (after ffmpeg, before first input)
    const ffmpegMatch = cleaned.match(/ffmpeg\s+/);
    if (ffmpegMatch) {
      const insertPos = ffmpegMatch.index! + ffmpegMatch[0].length;
      const before = cleaned.substring(0, insertPos);
      const after = cleaned.substring(insertPos);
      const newCommand = `${before}-threads ${this.maxThreads} ${after}`;
      return this.wrapCommand(newCommand);
    }

    // Fallback: prepend -threads after ffmpeg
    const newCommand = cleaned.replace(/ffmpeg\s+/, `ffmpeg -threads ${this.maxThreads} `);
    return this.wrapCommand(newCommand);
  }

  /**
   * Wrap command with nice/ionice
   */
  private wrapCommand(command: string): string[] {
    const parts: string[] = [];
    
    if (this.useIonice) {
      parts.push('ionice', '-c', '3');
    }
    
    if (this.useNice) {
      parts.push('nice', '-n', this.nicePriority.toString());
    }
    
    // Split command into parts
    const commandParts = command.trim().split(/\s+/);
    parts.push(...commandParts);
    
    return parts;
  }

  /**
   * Execute FFmpeg command synchronously with resource limits
   */
  execSync(command: string, options: FFmpegOptions = {}): string {
    const timeout = options.timeout || this.defaultTimeout;
    const stdio = options.stdio || 'inherit';
    const encoding = options.encoding || 'utf-8';
    const maxBuffer = options.maxBuffer || 10 * 1024 * 1024; // 10MB default

    const finalCommand = this.buildFFmpegCommand(command);
    
    // If it's a simple command string, execute it directly
    if (typeof command === 'string' && command.includes('ffmpeg')) {
      // Build the full command with nice/ionice
      let wrappedCommand = '';
      if (this.useIonice) {
        wrappedCommand += `ionice -c 3 `;
      }
      if (this.useNice) {
        wrappedCommand += `nice -n ${this.nicePriority} `;
      }
      
      // Add -threads if not present
      if (!command.includes('-threads')) {
        wrappedCommand += command.replace(/ffmpeg\s+/, `ffmpeg -threads ${this.maxThreads} `);
      } else {
        // Replace existing threads value
        wrappedCommand += command.replace(/-threads\s+\d+/, `-threads ${this.maxThreads}`);
      }

      try {
        return execSync(wrappedCommand, {
          stdio,
          encoding,
          maxBuffer,
          timeout,
        } as any);
      } catch (error: any) {
        throw new Error(`FFmpeg execution failed: ${error.message}`);
      }
    }

    // For array-based commands, use spawn approach
    throw new Error('Use execSyncString or spawn for array-based commands');
  }

  /**
   * Execute FFmpeg command synchronously (string-based)
   */
  execSyncString(command: string, options: FFmpegOptions = {}): string {
    const timeout = options.timeout || this.defaultTimeout;
    const stdio = options.stdio || 'inherit';
    const encoding = options.encoding || 'utf-8';
    const maxBuffer = options.maxBuffer || 10 * 1024 * 1024;

    // Build wrapped command
    let wrappedCommand = '';
    if (this.useIonice) {
      wrappedCommand += `ionice -c 3 `;
    }
    if (this.useNice) {
      wrappedCommand += `nice -n ${this.nicePriority} `;
    }

    // Add -threads if not present
    if (!command.includes('-threads')) {
      wrappedCommand += command.replace(/ffmpeg\s+/, `ffmpeg -threads ${this.maxThreads} `);
    } else {
      // Replace existing threads value
      wrappedCommand += command.replace(/-threads\s+\d+/, `-threads ${this.maxThreads}`);
    }

    try {
      return execSync(wrappedCommand, {
        stdio,
        encoding,
        maxBuffer,
        timeout,
      } as any);
    } catch (error: any) {
      throw new Error(`FFmpeg execution failed: ${error.message}`);
    }
  }

  /**
   * Execute FFmpeg command asynchronously with resource limits
   */
  spawn(
    command: string,
    options: FFmpegOptions = {}
  ): Promise<FFmpegResult> {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || this.defaultTimeout;
      const stdio = options.stdio || ['ignore', 'pipe', 'pipe'];

      // Build wrapped command
      let wrappedCommand = '';
      if (this.useIonice) {
        wrappedCommand += `ionice -c 3 `;
      }
      if (this.useNice) {
        wrappedCommand += `nice -n ${this.nicePriority} `;
      }

      // Add -threads if not present
      if (!command.includes('-threads')) {
        wrappedCommand += command.replace(/ffmpeg\s+/, `ffmpeg -threads ${this.maxThreads} `);
      } else {
        // Replace existing threads value
        wrappedCommand += command.replace(/-threads\s+\d+/, `-threads ${this.maxThreads}`);
      }

      // Parse command into array for spawn
      const commandParts = wrappedCommand.trim().split(/\s+/);
      const executable = commandParts[0];
      const args = commandParts.slice(1);

      const process = spawn(executable, args, {
        stdio: stdio as any,
      });

      let stdout = '';
      let stderr = '';

      // Set timeout
      const timeoutHandle = setTimeout(() => {
        process.kill('SIGTERM');
        reject(new Error(`FFmpeg process timed out after ${timeout}ms`));
      }, timeout);

      // Capture output
      if (process.stdout) {
        process.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }

      if (process.stderr) {
        process.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      process.on('close', (code) => {
        clearTimeout(timeoutHandle);
        if (code === 0) {
          resolve({
            success: true,
            stdout,
            stderr,
          });
        } else {
          resolve({
            success: false,
            stdout,
            stderr,
            error: new Error(`FFmpeg process exited with code ${code}`),
          });
        }
      });

      process.on('error', (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
    });
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return {
      maxThreads: this.maxThreads,
      nicePriority: this.nicePriority,
      useNice: this.useNice,
      useIonice: this.useIonice,
      defaultTimeout: this.defaultTimeout,
    };
  }
}

