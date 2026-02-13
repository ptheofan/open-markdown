/**
 * Application menu for macOS
 */
import { app, BrowserWindow, Menu, shell } from 'electron';

import { getWindowManager } from '../window/WindowManager';
import { IPC_CHANNELS } from '@shared/types';

const WEBSITE_URL = 'https://ptheofan.github.io/open-markdown/';
const ISSUES_URL = 'https://github.com/ptheofan/open-markdown/issues';

function sendMenuAction(action: string): void {
  const win = BrowserWindow.getFocusedWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.MENU.ACTION, action);
  }
}

export function setupApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'Cmd+,',
          click: () => sendMenuAction('open-preferences'),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            getWindowManager().createWindow();
          },
        },
        {
          label: 'Open File...',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('open-file'),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'copy' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find...',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendMenuAction('find'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => sendMenuAction('zoom-in'),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => sendMenuAction('zoom-out'),
        },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => sendMenuAction('zoom-reset'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'windowMenu',
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Open Markdown Website',
          click: () => {
            void shell.openExternal(WEBSITE_URL);
          },
        },
        {
          label: 'Report an Issue',
          click: () => {
            void shell.openExternal(ISSUES_URL);
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  app.setAboutPanelOptions({
    applicationName: 'Open Markdown',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026 ARALU Single Member P.C.',
    website: WEBSITE_URL,
  });
}
