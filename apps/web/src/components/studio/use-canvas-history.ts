import { useReducer, useEffect, useCallback } from 'react';
import type { CanvasItem } from '@sakura/core';
import { canvasReducer, undo, redo } from './canvas-history';

/**
 * 画布编辑历史 hook
 * 支持 Ctrl/Cmd + Z 撤销，Ctrl/Cmd + Y 重做
 */
export function useCanvasHistory(initialItems: CanvasItem[]) {
  const [state, dispatch] = useReducer(canvasReducer, {
    items: initialItems,
    history: [initialItems],
    historyIndex: 0,
  });

  const handleUndo = useCallback(() => {
    const newState = undo(state);
    dispatch({ type: 'ITEMS_LOADED', items: newState.items });
  }, [state]);

  const handleRedo = useCallback(() => {
    const newState = redo(state);
    dispatch({ type: 'ITEMS_LOADED', items: newState.items });
  }, [state]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);

  return { state, dispatch, canUndo: state.historyIndex > 0, canRedo: state.historyIndex < state.history.length - 1 };
}
