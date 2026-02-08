import { execSync } from 'child_process';
import * as os from 'os';

export interface FFmpegProcessInfo {
  pid: number;
  cpuPercent: number;
  memoryMB: number;
  command: string;
  startTime: string;
}

/**
 * FFmpeg Process Monitor
 * Tracks active FFmpeg processes and their resource usage
 */
export class FFmpegMonitor {
  /**
   * Get all active FFmpeg processes
   */
  static getActiveFFmpegProcesses(): FFmpegProcessInfo[] {
    try {
      const platform = os.platform();
      let command: string;
      let parseFunction: (output: string) => FFmpegProcessInfo[];

      if (platform === 'linux' || platform === 'darwin') {
        // Use ps command for Unix-like systems
        command = "ps aux | grep '[f]fmpeg' | awk '{print $2,$3,$4,$11,$9}'";
        parseFunction = this.parseUnixPsOutput;
      } else {
        // Windows - use tasklist (not commonly used in production, but included for completeness)
        command = 'tasklist /FI "IMAGENAME eq ffmpeg.exe" /FO CSV';
        parseFunction = this.parseWindowsTasklistOutput;
      }

      const output = execSync(command, { encoding: 'utf-8' });
      return parseFunction(output);
    } catch (error: any) {
      // If command fails (e.g., no FFmpeg processes), return empty array
      if (error.message?.includes('grep') || error.message?.includes('tasklist')) {
        return [];
      }
      console.warn(`[FFmpegMonitor] Failed to get FFmpeg processes: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse Unix ps output
   */
  private static parseUnixPsOutput(output: string): FFmpegProcessInfo[] {
    const processes: FFmpegProcessInfo[] = [];
    const lines = output.trim().split('\n').filter(line => line.trim());

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) {
        const pid = parseInt(parts[0], 10);
        const cpuPercent = parseFloat(parts[1]);
        const memoryPercent = parseFloat(parts[2]);
        
        // Get memory in MB (approximate)
        const totalMemoryMB = os.totalmem() / (1024 * 1024);
        const memoryMB = (memoryPercent / 100) * totalMemoryMB;

        // Get command (parts[3] onwards, but we'll take a simplified version)
        const command = parts.slice(3).join(' ').substring(0, 100); // Limit length
        const startTime = parts[parts.length - 1] || 'unknown';

        if (!isNaN(pid) && !isNaN(cpuPercent)) {
          processes.push({
            pid,
            cpuPercent,
            memoryMB: Math.round(memoryMB * 100) / 100,
            command,
            startTime,
          });
        }
      }
    }

    return processes;
  }

  /**
   * Parse Windows tasklist output
   */
  private static parseWindowsTasklistOutput(output: string): FFmpegProcessInfo[] {
    // Windows parsing is more complex and less commonly used
    // This is a simplified version
    const processes: FFmpegProcessInfo[] = [];
    const lines = output.trim().split('\n').slice(1); // Skip header

    for (const line of lines) {
      // CSV format: "ffmpeg.exe","1234","Session Name","Session#","Mem Usage"
      const match = line.match(/"([^"]+)","(\d+)","[^"]*","\d+","([^"]+)"/);
      if (match) {
        const pid = parseInt(match[2], 10);
        const memUsage = match[3].replace(/[^\d]/g, ''); // Extract numbers
        const memoryMB = parseInt(memUsage, 10) || 0;

        processes.push({
          pid,
          cpuPercent: 0, // Windows tasklist doesn't show CPU
          memoryMB,
          command: match[1],
          startTime: 'unknown',
        });
      }
    }

    return processes;
  }

  /**
   * Get summary statistics of FFmpeg processes
   */
  static getSummary(): {
    totalProcesses: number;
    totalCpuPercent: number;
    totalMemoryMB: number;
    averageCpuPercent: number;
    averageMemoryMB: number;
  } {
    const processes = this.getActiveFFmpegProcesses();

    if (processes.length === 0) {
      return {
        totalProcesses: 0,
        totalCpuPercent: 0,
        totalMemoryMB: 0,
        averageCpuPercent: 0,
        averageMemoryMB: 0,
      };
    }

    const totalCpuPercent = processes.reduce((sum, p) => sum + p.cpuPercent, 0);
    const totalMemoryMB = processes.reduce((sum, p) => sum + p.memoryMB, 0);

    return {
      totalProcesses: processes.length,
      totalCpuPercent: Math.round(totalCpuPercent * 100) / 100,
      totalMemoryMB: Math.round(totalMemoryMB * 100) / 100,
      averageCpuPercent: Math.round((totalCpuPercent / processes.length) * 100) / 100,
      averageMemoryMB: Math.round((totalMemoryMB / processes.length) * 100) / 100,
    };
  }

  /**
   * Log current FFmpeg process status
   */
  static logStatus(): void {
    const summary = this.getSummary();
    const processes = this.getActiveFFmpegProcesses();

    console.log(`[FFmpegMonitor] Active FFmpeg processes: ${summary.totalProcesses}`);
    console.log(`[FFmpegMonitor] Total CPU usage: ${summary.totalCpuPercent.toFixed(2)}%`);
    console.log(`[FFmpegMonitor] Total memory usage: ${summary.totalMemoryMB.toFixed(2)} MB`);

    if (processes.length > 0) {
      console.log(`[FFmpegMonitor] Process details:`);
      processes.forEach((p, i) => {
        console.log(
          `[FFmpegMonitor]   ${i + 1}. PID ${p.pid}: CPU ${p.cpuPercent.toFixed(2)}%, Memory ${p.memoryMB.toFixed(2)} MB`
        );
      });
    }

    // Warn if CPU usage is very high
    if (summary.totalCpuPercent > 200) {
      console.warn(
        `[FFmpegMonitor] ⚠️  High CPU usage detected: ${summary.totalCpuPercent.toFixed(2)}% across ${summary.totalProcesses} processes`
      );
    }
  }

  /**
   * Check if system is under heavy FFmpeg load
   */
  static isUnderHeavyLoad(thresholdCpuPercent: number = 150): boolean {
    const summary = this.getSummary();
    return summary.totalCpuPercent > thresholdCpuPercent;
  }
}

