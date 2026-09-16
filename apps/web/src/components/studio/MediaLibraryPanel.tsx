'use client';

import { useState, useCallback } from 'react';
import clsx from 'clsx';
import { Badge, Button, Empty, Field, Input, Select } from '@/components/ui';
import type { MediaFile } from '@sakura/core';
import { createCanvasItemAction } from '@/app/actions/canvas';
import { exportCanvasAsTimelineAction } from '@/app/actions/export-canvas';

interface MediaLibraryPanelProps {
  projectId: string;
  media: Record<string, MediaFile>;
  canvasItemCount?: number;
  onItemAdded?: (itemId: string) => void;
  onExporting?: (jobId: string) => void;
}

export function MediaLibraryPanel({
  projectId,
  media,
  canvasItemCount = 0,
  onItemAdded,
  onExporting,
}: MediaLibraryPanelProps) {
  const [filter, setFilter] = useState<'all' | 'image' | 'video' | 'audio'>('all');
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState(10);
  const [showExportPanel, setShowExportPanel] = useState(false);

  const items = Object.values(media).filter((m) => {
    if (filter === 'all') return true;
    return m.kind === filter;
  });

  const handleAddToCanvas = useCallback(
    async (mediaItem: MediaFile) => {
      setLoading(true);
      try {
        const result = await createCanvasItemAction(projectId, {
          kind: mediaItem.kind as 'image' | 'video' | 'audio',
          mediaId: mediaItem.id,
          url: mediaItem.url,
          text: mediaItem.prompt || mediaItem.url?.split('/').pop() || '素材',
          x: Math.random() * 200,
          y: Math.random() * 200,
          width: mediaItem.kind === 'image' ? 300 : mediaItem.kind === 'video' ? 400 : 300,
          height: mediaItem.kind === 'image' ? 300 : mediaItem.kind === 'video' ? 300 : 60,
          z: 0,
        });
        if (result.ok && result.data) {
          onItemAdded?.(result.data.id);
        }
      } finally {
        setLoading(false);
      }
    },
    [projectId, onItemAdded],
  );

  const handleExport = async () => {
    setLoading(true);
    try {
      const result = await exportCanvasAsTimelineAction(projectId, { duration });
      if (result.ok && result.jobId) {
        onExporting?.(result.jobId);
        setShowExportPanel(false);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {canvasItemCount > 0 && (
        <Button
          variant="primary"
          className="w-full"
          loading={loading}
          onClick={() => setShowExportPanel(!showExportPanel)}
          size="sm"
        >
          🎬 导出为视频
        </Button>
      )}

      {showExportPanel && (
        <div className="rounded-lg border border-pink-400/40 bg-pink-500/10 p-3 space-y-2">
          <Field label="视频时长（秒）">
            <Input
              type="number"
              min="1"
              max="300"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="text-sm"
            />
          </Field>
          <div className="flex gap-2">
            <Button
              variant="primary"
              className="flex-1"
              loading={loading}
              onClick={handleExport}
              size="sm"
            >
              导出
            </Button>
            <Button
              variant="default"
              className="flex-1"
              onClick={() => setShowExportPanel(false)}
              size="sm"
            >
              取消
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-1.5">
        {(['all', 'image', 'video', 'audio'] as const).map((kind) => (
          <button
            key={kind}
            onClick={() => setFilter(kind)}
            className={clsx(
              'px-2.5 py-1 text-[12px] rounded border transition-colors',
              filter === kind
                ? 'bg-pink-500/20 border-pink-400/60 text-pink-200'
                : 'bg-white/5 border-[#333b4a] text-slate-400 hover:bg-white/10',
            )}
          >
            {kind === 'all' ? '全部' : kind === 'image' ? '图片' : kind === 'video' ? '视频' : '语音'}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <Empty text={filter === 'all' ? '项目暂无素材' : `暂无${filter === 'image' ? '图片' : filter === 'video' ? '视频' : '语音'}`} />
      ) : (
        <div className="grid grid-cols-2 gap-2 max-h-[300px] overflow-y-auto">
          {items.map((item) => (
            <div
              key={item.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  'application/json',
                  JSON.stringify({ kind: item.kind, url: item.url, name: item.prompt || item.url?.split('/').pop() || '素材' }),
                );
                e.dataTransfer.effectAllowed = 'copy';
              }}
              className="group relative rounded-lg border border-[#333b4a] bg-[#12151c] overflow-hidden hover:border-pink-400/40 transition-colors cursor-pointer active:cursor-grabbing"
              onClick={() => void handleAddToCanvas(item)}
            >
              {item.kind === 'image' && (
                <img
                  src={item.url}
                  alt={item.prompt || 'image'}
                  className="w-full h-20 object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                />
              )}
              {item.kind === 'video' && (
                <video src={item.url} className="w-full h-20 object-cover opacity-80 group-hover:opacity-100" />
              )}
              {item.kind === 'audio' && (
                <div className="w-full h-20 flex items-center justify-center bg-[#0e1116]">
                  <span className="text-[11px] text-slate-400">♪ 音频</span>
                </div>
              )}

              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                <Badge tone={item.kind === 'image' ? 'default' : item.kind === 'video' ? 'pink' : 'blue'}>
                  +添加
                </Badge>
              </div>

              <div className="text-[10px] text-slate-500 truncate p-1 bg-[#0e1116]">{item.prompt?.slice(0, 20) || 'media'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

