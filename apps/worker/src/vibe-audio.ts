import { spawn } from 'node:child_process';
import { writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Language, VibeProject } from '@sakura/core';
import { requireVibeMusic, resolveMediaPath, runAudio } from '@sakura/pipeline';
import { downloadToBuffer } from '@sakura/core/server';
import type { VibeRenderOptions } from './vibe-render';

/** 仅执行固定参数，不经过 shell；取消/超时后等待进程退出再清理文件。 */
async function run(executable: string, args: string[], options: VibeRenderOptions): Promise<string> {
  if (options.isCanceled?.()) throw new Error('配音已取消');
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', reason = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-8192); });
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192); });
  const started = Date.now();
  const timer = setInterval(() => {
    if (options.isCanceled?.() || Date.now() - started > 120_000) {
      reason = options.isCanceled?.() ? '配音已取消' : '音频处理超时';
      child.kill('SIGKILL');
    }
  }, 100);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', () => reject(new Error('无法启动音频处理器，请检查编码器与探测器路径')));
      child.once('close', (code) => code === 0 && !reason ? resolve() : reject(new Error(reason || `音频处理失败：${stderr.slice(-600)}`)));
    });
    return stdout;
  } finally { clearInterval(timer); }
}

/** 配音时长超出场次时显式加速，不静默截断旁白。 */
export function vibeTempoFilters(ratio: number): string[] {
  if (!Number.isFinite(ratio) || ratio < 1 || ratio > 2) throw new Error('配音对齐仅支持 1–2 倍速');
  return [`atempo=${ratio}`];
}

export async function addVibeDubbing(
  vibe: VibeProject, language: Language, video: string, output: string, workDir: string, options: VibeRenderOptions,
): Promise<void> {
  if (!vibe.script) throw new Error('配音缺少脚本');
  const ffmpeg = options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = process.env.FFPROBE_PATH || ffmpeg.replace(/ffmpeg(\.exe)?$/i, (name) => name.replace(/ffmpeg/i, 'ffprobe'));
  const shots = vibe.script.shots;
  const segments: string[] = [];
  if (vibe.dubbing.enabled && !shots.some((shot) => shot.narration.trim())) throw new Error('脚本没有可配音的旁白');
  for (const [index, shot] of (vibe.dubbing.enabled ? shots : []).entries()) {
    if (options.isCanceled?.()) throw new Error('配音已取消');
    options.onProgress?.(Math.round(index / shots.length * 80), `正在配音 ${index + 1}/${shots.length} 场`);
    const segment = join(workDir, `segment-${index}.wav`);
    const common = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
    if (!shot.narration.trim()) {
      await run(ffmpeg, [...common, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', String(shot.durationSec), segment], options);
    } else {
      const audio = await runAudio({ input: shot.narration, voice: vibe.dubbing.voice || undefined,
        speed: vibe.dubbing.speed, volume: vibe.dubbing.volume, pitch: vibe.dubbing.pitch, language, format: 'mp3' });
      if (options.isCanceled?.()) throw new Error('配音已取消，忽略迟到响应');
      const source = audio.url ?? audio.b64;
      if (!source) throw new Error(`第 ${index + 1} 场未返回音频`);
      // 中间音频仅写隔离工作区，不暴露到媒体服务或建立半成品记录。
      const raw = join(workDir, `source-${index}.mp3`);
      const inline = source.match(/^data:[^;]+;base64,([\s\S]+)$/);
      const controller = new AbortController();
      const cancel = setInterval(() => { if (options.isCanceled?.()) controller.abort(); }, 100);
      try {
        const buffer = inline ? Buffer.from(inline[1]!, 'base64')
          : (await downloadToBuffer(source, { signal: controller.signal, timeoutMs: 120_000 })).buffer;
        if (options.isCanceled?.()) throw new Error('配音已取消');
        if (!buffer.byteLength || buffer.byteLength > 32 * 1024 * 1024) throw new Error('单场配音为空或超过 32 MiB 上限');
        await writeFile(raw, buffer);
      } finally { clearInterval(cancel); }
      const duration = Number((await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', raw], options)).trim());
      if (!Number.isFinite(duration) || duration <= 0) throw new Error(`第 ${index + 1} 场配音时长无效`);
      const ratio = Math.max(1, duration / shot.durationSec * 1.02);
      if (ratio > 2) throw new Error(`第 ${index + 1} 场旁白过长，请缩短旁白或延长场次后重新确认导出`);
      if (ratio > 1.02) options.onLog?.(`第 ${index + 1} 场配音按 ${ratio.toFixed(2)} 倍速对齐；可延长场次改善语速`);
      await run(ffmpeg, [...common, '-i', raw, '-af', [...vibeTempoFilters(ratio), 'apad', `atrim=duration=${shot.durationSec}`].join(','), '-ar', '48000', '-ac', '1', segment], options);
    }
    segments.push(segment);
    options.onLog?.(`第 ${index + 1}/${shots.length} 场配音对齐完成`);
  }
  options.onProgress?.(85, '正在合成配音、音乐与最终视频');
  // 文件名全部由本函数生成，使用相对路径避免跨平台路径转义。
  const list = join(workDir, 'audio-list.txt');
  const track = join(workDir, 'narration.wav');
  const duration = shots.reduce((sum, shot) => sum + shot.durationSec, 0);
  const args = ['-v', 'error', '-nostdin', '-y', '-i', video];
  if (segments.length) {
    await writeFile(list, segments.map((_, index) => `file 'segment-${index}.wav'`).join('\n'));
    await run(ffmpeg, ['-v', 'error', '-nostdin', '-y', '-f', 'concat', '-safe', '1', '-i', list, '-c', 'copy', track], options);
    args.push('-i', track);
  }
  const music = vibe.dubbing.music;
  if (music) {
    const media = requireVibeMusic(vibe.projectId, music.mediaId);
    const path = resolveMediaPath(media.path)!;
    const probe = JSON.parse(await run(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries',
      'stream=codec_type:format=duration', '-of', 'json', path], options)) as {
        streams?: Array<{ codec_type?: string }>; format?: { duration?: string };
      };
    if (!probe.streams?.some((stream) => stream.codec_type === 'audio') || !(Number(probe.format?.duration) > 0)) {
      throw new Error('背景音乐无法解码或没有有效音轨，请重新上传');
    }
    if (music.loop) args.push('-stream_loop', '-1');
    args.push('-i', path);
    const index = segments.length ? 2 : 1;
    const filters = [`[${index}:a:0]aresample=48000,volume=${music.volume},apad,atrim=duration=${duration}[music]`];
    if (segments.length) filters.push('[1:a:0][music]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95:level=0[audio]');
    args.push('-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', segments.length ? '[audio]' : '[music]');
    options.onLog?.(`背景音乐已加入，音量 ${Math.round(music.volume * 100)}%，${music.loop ? '循环播放' : '播放一次后补静音'}`);
  } else {
    args.push('-map', '0:v:0', '-map', '1:a:0', '-af', 'apad');
  }
  await run(ffmpeg, [...args, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(duration), '-movflags', '+faststart', output], options);
  if ((await stat(output)).size < 32) throw new Error('配音成片为空');
  options.onProgress?.(100, '音频合成完成');
}
