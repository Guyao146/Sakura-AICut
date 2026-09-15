/**
 * 画布编辑历史管理
 */

type CanvasAction =
  | { type: 'ITEMS_LOADED'; items: CanvasItem[] }
  | { type: 'ITEM_ADDED'; item: CanvasItem }
  | { type: 'ITEM_UPDATED'; id: string; patch: Partial<CanvasItem> }
  | { type: 'ITEM_DELETED'; id: string }
  | { type: 'ITEM_MOVED'; id: string; x: number; y: number }
  | { type: 'BATCH_UPDATE'; updates: Array<{ id: string; patch: Partial<CanvasItem> }> };

interface CanvasState {
  items: CanvasItem[];
  history: CanvasItem[][];
  historyIndex: number;
}

export function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  // 保存状态到历史（撤销前）
  const saveToHistory = (newItems: CanvasItem[]): CanvasState => {
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(newItems);
    // 限制历史栈大小为 50
    if (newHistory.length > 50) {
      newHistory.shift();
    }
    return {
      items: newItems,
      history: newHistory,
      historyIndex: newHistory.length - 1,
    };
  };

  switch (action.type) {
    case 'ITEMS_LOADED':
      return {
        items: action.items,
        history: [action.items],
        historyIndex: 0,
      };

    case 'ITEM_ADDED':
      return saveToHistory([...state.items, action.item]);

    case 'ITEM_UPDATED':
      return saveToHistory(
        state.items.map((it) => (it.id === action.id ? { ...it, ...action.patch } : it)),
      );

    case 'ITEM_DELETED':
      return saveToHistory(state.items.filter((it) => it.id !== action.id));

    case 'ITEM_MOVED':
      return saveToHistory(
        state.items.map((it) => (it.id === action.id ? { ...it, x: action.x, y: action.y } : it)),
      );

    case 'BATCH_UPDATE':
      return saveToHistory(
        state.items.map((item) => {
          const update = action.updates.find((u) => u.id === item.id);
          return update ? { ...item, ...update.patch } : item;
        }),
      );

    default:
      return state;
  }
}

export function undo(state: CanvasState): CanvasState {
  if (state.historyIndex <= 0) return state;
  return {
    ...state,
    historyIndex: state.historyIndex - 1,
    items: state.history[state.historyIndex - 1]!,
  };
}

export function redo(state: CanvasState): CanvasState {
  if (state.historyIndex >= state.history.length - 1) return state;
  return {
    ...state,
    historyIndex: state.historyIndex + 1,
    items: state.history[state.historyIndex + 1]!,
  };
}
