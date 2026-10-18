import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import type { Frame, Page } from 'playwright';
import type { VibeProtocolMeta } from '@sakura/core';
import { planVibeFrames } from '@sakura/core';

/** 只接收内联帧数据；错误与关闭均使背压等待退出，不积累整段视频到内存。 */
export async function encodeVibeFrames(page: Page, frame: Frame, meta: VibeProtocolMeta, outputPath: string, ffmpegPath: string,
  progress: (percent: number, stage: string) => void): Promise<void> {
  const { times, fps } = planVibeFrames(meta);
  const child = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(fps), '-i', 'pipe:0',
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '20',
    '-frames:v', String(times.length), '-threads', '2', '-movflags', '+faststart', outputPath,
  ], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let diagnostic = '';
  child.stderr.on('data', (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString()).slice(-4096); });
  let processError: Error | null = null;
  child.stdin.on('error', (error) => { processError = error; });
  const finished = new Promise<void>((resolve, reject) => {
    child.once('error', (error) => { processError = error; reject(new Error('无法启动视频编码器，请检查路径与依赖')); });
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`视频编码失败（退出码 ${code}）：${diagnostic.slice(-600)}`));
    });
  });
  void finished.catch(() => {});
  try {
    for (let index = 0; index < times.length; index += 1) {
      if (processError) throw new Error('视频编码管道已关闭');
      await frame.evaluate(`(() => {
        const value = window.__vibeSeek(${times[index]});
        if (value && typeof value.then === 'function') throw new Error('寻帧必须同步完成');
        for (const animation of document.getAnimations()) animation.pause();
      })()`);
      const image = await page.screenshot({ type: 'png', timeout: 15_000 });
      await Promise.race([
        new Promise<void>((resolve, reject) => child.stdin.write(image, (error) => error
          ? reject(new Error('视频编码管道写入失败', { cause: error })) : resolve())),
        finished.then(() => { throw new Error('视频编码器提前结束'); }),
      ]);
      if (index % 12 === 0 || index === times.length - 1) {
        progress(10 + Math.round((index + 1) / times.length * 82), `已渲染 ${index + 1}/${times.length} 帧`);
      }
    }
    child.stdin.end();
    progress(95, '完成 MP4 编码');
    await finished;
    if ((await stat(outputPath)).size < 32) throw new Error('视频编码产物为空');
  } finally {
    child.stdin.destroy();
    if (child.exitCode === null) child.kill('SIGKILL');
    await finished.catch(() => {});
  }
}
