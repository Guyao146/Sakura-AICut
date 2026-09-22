/**
 * 右键菜单统一助手：解决「重复右键时菜单逐个叠加不消失」的问题。
 * - 每次打开新菜单前先清除所有旧菜单
 * - 全局监听 pointerdown / contextmenu：点击或右键菜单外部时自动关闭
 */

const MENU_ATTR = 'data-context-menu';

/** 抑制窗口级 contextmenu 关闭的截止时间（打开菜单的同一个事件冒泡到 window 时不要把刚开的菜单关掉） */
let suppressUntil = 0;

export interface MenuItem {
  label: string;
  icon?: string;
  action: () => void | Promise<void>;
  danger?: boolean;
  /** 为 true 时该项不渲染 */
  hide?: boolean;
}

/** 关闭所有已打开的右键菜单 */
export function closeAllContextMenus(): void {
  document.querySelectorAll(`[${MENU_ATTR}]`).forEach((el) => el.remove());
}

/**
 * 打开一个右键菜单（会先关闭已有菜单）
 * @param items 菜单项
 * @param x 屏幕坐标 x（clientX）
 * @param y 屏幕坐标 y（clientY）
 */
export function openContextMenu(items: MenuItem[], x: number, y: number): HTMLElement {
  closeAllContextMenus();
  suppressUntil = Date.now() + 60;

  const menu = document.createElement('div');
  menu.setAttribute(MENU_ATTR, 'true');
  // 宽度由内容决定（w-max），不再用 min-w 撑出右侧空白
  menu.className =
    'fixed z-50 w-max rounded-lg border border-[#333b4a] bg-[#1a1f2e] py-1 text-xs shadow-xl shadow-black/50 animate-fade-in';

  for (const item of items) {
    if (item.hide) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.icon ? `${item.icon} ${item.label}` : item.label;
    btn.className = item.danger
      ? 'block w-full text-left px-3 py-1.5 text-red-300 transition-colors hover:bg-red-500/10'
      : 'block w-full text-left px-3 py-1.5 text-slate-200 transition-colors hover:bg-white/5';
    btn.onclick = async (event) => {
      event.stopPropagation();
      closeAllContextMenus();
      await item.action();
    };
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);

  // append 后实测尺寸，保证菜单不超出视口
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(Math.max(8, x), window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(Math.max(8, y), window.innerHeight - rect.height - 8)}px`;

  return menu;
}

if (typeof window !== 'undefined') {
  // 点击菜单外部时关闭
  window.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement | null;
    if (target && target.closest(`[${MENU_ATTR}]`)) return;
    closeAllContextMenus();
  });
  // 右键菜单外部时关闭（本次刚打开的菜单除外）
  window.addEventListener('contextmenu', (event) => {
    if (Date.now() < suppressUntil) return;
    const target = event.target as HTMLElement | null;
    if (target && target.closest(`[${MENU_ATTR}]`)) {
      event.preventDefault();
      return;
    }
    closeAllContextMenus();
  });
}
