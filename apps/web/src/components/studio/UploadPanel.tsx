'use client';

import { useCallback, useRef, useState } from 'react';
import clsx from 'clsx';
import { Button, Badge } from '@/components/ui';
import { uploadCanvasMediaAction } from '@/app/actions/upload';
import { createCanvasItemAction } from '@/app/actions/canvas';
import type { MediaFile } from '@sakura/core';

interface UploadPanelProps {
  projectId: string;
  onMediaAdded?: (media: MediaFile) => void;
}

export function UploadPanel({ projectId, onMediaAdded }: UploadPanelProps) {
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(
    async (files: FileList) => {
      setLoading(true);
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i]!;
          const uploadResult = await uploadCanvasMediaAction(projectId, file);

          if (uploadResult.ok && uploadResult.data) {
            const media = uploadResult.data;
            // 自动添加到画布
            await createCanvasItemAction(projectId, {
              kind: media.kind as 'image' | 'video' | 'audio',
              mediaId: media.id,
              url: media.url,
              text: file.name,
              x: Math.random() * 200,
              y: Math.random() * 200,
              width: media.kind === 'image' ? 300 : media.kind === 'video' ? 400 : 300,
              height: media.kind === 'image' ? 300 : media.kind === 'video' ? 300 : 60,
              z: 0,
            });
            onMediaAdded?.(media);
          }
        }
      } finally {
        setLoading(false);
      }
    },
    [projectId, onMediaAdded],
  );

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type !== 'dragleave');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) {
      void handleUpload(e.dataTransfer.files);
    }
  };

  return (
    <div className="space-y-2">
      <div
        className={clsx(
          'relative rounded-lg border-2 border-dashed p-4 text-center transition-colors cursor-pointer',
          dragActive ? 'border-pink-400/60 bg-pink-500/10' : 'border-[#333b4a] hover:border-pink-400/40',
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              void handleUpload(e.target.files);
            }
          }}
        />
        <div className="text-xs text-slate-400">
          <div className="mb-2">拖拽或点击上传</div>
          <div className="text-[10px] text-slate-500">支持图片、视频、音频</div>
        </div>
      </div>

      <Button
        variant="primary"
        size="sm"
        className="w-full"
        loading={loading}
        onClick={() => inputRef.current?.click()}
      >
        {loading ? '上传中...' : '选择文件'}
      </Button>
    </div>
  );
}
