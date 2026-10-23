'use client';

import { useEffect, useState } from 'react';
import type { AudioVoice, MediaFile, VibeDubbing } from '@sakura/core';
import { loadVibeVoicesAction, previewVibeVoiceAction } from '@/app/actions/vibe';
import { Button, Field, Input, Select } from '@/components/ui';

export function VibeAudioSettings({ projectId, value, onChange, disabled, media, onBusyChange }: {
  projectId: string; value: VibeDubbing; onChange: (patch: Partial<VibeDubbing>) => void;
  disabled: boolean; media: MediaFile[]; onBusyChange: (busy: boolean) => void;
}) {
  const [voices, setVoices] = useState<AudioVoice[]>([]);
  const [limits, setLimits] = useState({ min: 0.25, max: 4 });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [previewText, setPreviewText] = useState('你好，欢迎来到我的故事。让我们一起看看接下来会发生什么。');
  const [preview, setPreview] = useState('');
  const [uploads, setUploads] = useState<MediaFile[]>([]);
  const tracks = [...new Map([...uploads, ...media].map((item) => [item.id, item])).values()];
  const selected = tracks.find((item) => item.id === value.music?.mediaId);

  useEffect(() => { setPreview(''); }, [value.voice, value.speed, value.volume, value.pitch, previewText]);

  const work = async (fn: () => Promise<void>) => {
    setError('');
    onBusyChange(true);
    try { await fn(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { onBusyChange(false); }
  };

  return <div className="space-y-4">
    <div>
      <label className="mb-3 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={value.enabled} disabled={disabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
        启用旁白配音
      </label>
      <p className="mb-3 text-[11px] leading-5 text-slate-400">使用设置中的语音模型逐场合成旁白。较短音频补静音，超出场次时最多加速到 2 倍，过长会提示修改。可先试听音色，再保存用于最终导出。</p>
      <Button size="sm" disabled={disabled} onClick={() => void work(async () => {
        const result = await loadVibeVoicesAction(projectId);
        if (!result.ok || !result.data) throw new Error(result.error || '音色加载失败');
        setVoices(result.data.voices);
        setLimits({ min: result.data.minSpeed, max: result.data.maxSpeed });
        setNotice(result.data.supportsVoiceList ? `已加载 ${result.data.voices.length} 个音色 · ${result.data.model}` : '当前接口不提供音色列表，请从语音服务的控制台复制音色 ID。');
      })}>加载可用音色</Button>
      {notice ? <p className="my-2 break-words text-[11px] text-slate-400">{notice}</p> : null}
      {voices.length ? <Field label="可用音色">
        <Select aria-label="选择配音音色" value={voices.some((voice) => voice.id === value.voice) ? value.voice : ''} disabled={disabled} onChange={(event) => onChange({ voice: event.target.value })}>
          <option value="">接口默认 / 自定义 ID</option>
          {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
        </Select>
        <p className="mt-1 text-[11px] text-slate-500">{voices.find((voice) => voice.id === value.voice)?.description}</p>
      </Field> : null}
      <Field label="音色 ID（可自定义，留空使用接口默认）">
        <Input aria-label="配音音色" maxLength={120} disabled={disabled} value={value.voice} onChange={(event) => onChange({ voice: event.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`配音语速（${limits.min}–${limits.max}）`}>
          <Input aria-label="配音语速" type="number" min={limits.min} max={limits.max} step={0.05} disabled={disabled} value={value.speed} onChange={(event) => onChange({ speed: Number(event.target.value) })} />
        </Field>
        <Field label="配音音量（0.1–2）">
          <Input aria-label="配音音量" type="number" min={0.1} max={2} step={0.1} disabled={disabled} value={value.volume} onChange={(event) => onChange({ volume: Number(event.target.value) })} />
        </Field>
        <Field label="音调（-12–12）">
          <Input aria-label="配音音调" type="number" min={-12} max={12} step={1} disabled={disabled} value={value.pitch} onChange={(event) => onChange({ pitch: Number(event.target.value) })} />
        </Field>
      </div>
      <p className="mb-3 text-[11px] text-slate-500">音调与音量是否生效取决于语音接口，建议先试听。</p>
      <Field label="试听文本">
        <Input aria-label="配音试听文本" maxLength={120} disabled={disabled} value={previewText} onChange={(event) => setPreviewText(event.target.value)} />
      </Field>
      <Button size="sm" disabled={disabled || !previewText.trim()} onClick={() => void work(async () => {
        setPreview('');
        const result = await previewVibeVoiceAction(projectId, value, previewText);
        if (!result.ok || !result.data) throw new Error(result.error || '试听生成失败');
        setPreview(result.data);
      })}>生成音色试听</Button>
      <p className="mt-1 text-[11px] text-slate-500">试听调用当前语音模型，可能产生费用；不修改项目版本。</p>
      {preview ? <audio key={preview} aria-label="音色试听" src={preview} controls className="mt-2 w-full" /> : null}
    </div>
    <div className="border-t border-[#242a36] pt-4">
      <Field label="上传背景音乐" hint="最多 32 MiB">
        <Input aria-label="上传背景音乐" type="file" accept=".mp3,.wav,.m4a,.aac,.flac,.ogg" disabled={disabled} onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          void work(async () => {
            if (!file.size || file.size > 32 * 1024 * 1024) throw new Error('音乐文件不能为空或超过 32 MiB');
            const body = new FormData();
            body.set('projectId', projectId);
            body.set('file', file);
            const response = await fetch('/api/vibe/music', { method: 'POST', body });
            const result = await response.json() as { ok: boolean; error?: string; data?: MediaFile };
            if (!result.ok || !result.data) throw new Error(result.error || '音乐上传失败');
            const track = result.data;
            setUploads((current) => [track, ...current]);
            onChange({ music: { mediaId: track.id, name: file.name.slice(0, 200), volume: value.music?.volume ?? 0.2, loop: true } });
          });
        }} />
      </Field>
      {tracks.length ? <Field label="已上传音乐">
        <Select aria-label="背景音乐" value={value.music?.mediaId || ''} disabled={disabled} onChange={(event) => {
          const track = tracks.find((item) => item.id === event.target.value);
          onChange({ music: track ? { mediaId: track.id, name: track.prompt || '背景音乐', volume: value.music?.volume ?? 0.2, loop: value.music?.loop ?? true } : undefined });
        }}>
          <option value="">不使用背景音乐</option>
          {tracks.map((track) => <option key={track.id} value={track.id}>{track.prompt || track.id}</option>)}
        </Select>
      </Field> : null}
      {value.music ? <div>
        <p className="mb-2 break-words text-xs text-slate-300">{value.music.name}</p>
        {selected ? <audio aria-label="背景音乐试听" src={selected.url} controls preload="metadata" className="mb-3 w-full" /> : null}
        <Field label={`音乐音量：${Math.round(value.music.volume * 100)}%`}>
          <Input aria-label="背景音乐音量" type="range" min={0} max={1} step={0.01} disabled={disabled} value={value.music.volume} onChange={(event) => onChange({ music: { ...value.music!, volume: Number(event.target.value) } })} />
        </Field>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={value.music.loop} disabled={disabled} onChange={(event) => onChange({ music: { ...value.music!, loop: event.target.checked } })} />
          音乐不足时循环播放
        </label>
        <Button className="mt-2" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange({ music: undefined })}>移除背景音乐</Button>
      </div> : null}
      <p className="mt-2 text-[11px] leading-5 text-slate-500">支持 MP3、WAV、M4A、AAC、FLAC、OGG，可独立使用或与旁白混音。音乐默认音量 20%，导出时适配视频时长；动画预览不包含音频。</p>
    </div>
    {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : null}
  </div>;
}