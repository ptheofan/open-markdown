import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/types/api';
import { getGoogleAuthService } from '@main/services/GoogleAuthService';
import { getGoogleDocsLinkStore } from '@main/services/GoogleDocsLinkStore';
import { createGoogleDocsService } from '@main/services/GoogleDocsService';
import { createGoogleDocsSyncService } from '@main/services/GoogleDocsSyncService';
import type { MermaidDiagramData } from '@shared/types/google-docs';

function sendToAllWindows(channel: string, data: any): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

let authChangeCleanup: (() => void) | null = null;

export function registerGoogleDocsHandlers(): void {
  const authService = getGoogleAuthService();
  const linkStore = getGoogleDocsLinkStore();
  const docsService = createGoogleDocsService(() => authService.getAccessToken());
  const syncService = createGoogleDocsSyncService(docsService, linkStore);

  // Auth status
  ipcMain.handle(IPC_CHANNELS.GOOGLE_DOCS.AUTH_STATUS, () => {
    return authService.getAuthState();
  });

  // Sign in
  ipcMain.handle(IPC_CHANNELS.GOOGLE_DOCS.AUTH_SIGN_IN, async () => {
    try {
      const state = await authService.signIn();
      sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_AUTH_CHANGE, state);
      return state;
    } catch (error) {
      console.error('Google Docs sign-in error:', error);
      throw error;
    }
  });

  // Sign out
  ipcMain.handle(IPC_CHANNELS.GOOGLE_DOCS.AUTH_SIGN_OUT, async () => {
    await authService.signOut();
    const state = authService.getAuthState();
    sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_AUTH_CHANGE, state);
  });

  // Link file to doc
  ipcMain.handle(
    IPC_CHANNELS.GOOGLE_DOCS.LINK,
    async (_event, filePath: string, docUrl: string) => {
      const docId = authService.extractDocId(docUrl);
      if (!docId) {
        throw new Error(
          'Invalid Google Docs URL. Expected format: https://docs.google.com/document/d/...',
        );
      }
      await linkStore.setLink(filePath, docId);
      return linkStore.getLink(filePath);
    },
  );

  // Unlink
  ipcMain.handle(
    IPC_CHANNELS.GOOGLE_DOCS.UNLINK,
    async (_event, filePath: string) => {
      await linkStore.removeLink(filePath);
    },
  );

  // Get link
  ipcMain.handle(
    IPC_CHANNELS.GOOGLE_DOCS.GET_LINK,
    (_event, filePath: string) => {
      return linkStore.getLink(filePath);
    },
  );

  // Sync
  ipcMain.handle(
    IPC_CHANNELS.GOOGLE_DOCS.SYNC,
    async (_event, filePath: string, markdownContent: string, mermaidDiagrams?: MermaidDiagramData[]) => {
      try {
        console.log('[SYNC] Starting sync for:', filePath);
        const link = linkStore.getLink(filePath);
        console.log('[SYNC] Link:', link);
        if (!link) return { success: false, error: 'File not linked to Google Docs' };
        console.log('[SYNC] Calling syncService.sync...');
        sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_STATUS, { syncing: true });
        const result = await syncService.sync(filePath, link.docId, markdownContent, mermaidDiagrams);
        console.log('[SYNC] Result:', JSON.stringify(result));
        sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_STATUS, { syncing: false });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : '';
        console.error('Google Docs sync error:', message, '\n', stack);
        sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_STATUS, { syncing: false, error: message });
        return { success: false, error: message };
      }
    },
  );

  // Sync confirm overwrite
  ipcMain.handle(
    IPC_CHANNELS.GOOGLE_DOCS.SYNC_CONFIRM_OVERWRITE,
    async (_event, filePath: string, markdownContent: string, mermaidDiagrams?: MermaidDiagramData[]) => {
      const link = linkStore.getLink(filePath);
      if (!link) return { success: false, error: 'File not linked to Google Docs' };
      sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_STATUS, { syncing: true });
      try {
        const result = await syncService.syncForceOverwrite(
          filePath,
          link.docId,
          markdownContent,
          mermaidDiagrams,
        );
        sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_STATUS, { syncing: false });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Sync failed';
        console.error('Google Docs overwrite sync error:', error);
        sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_STATUS, { syncing: false, error: message });
        return { success: false, error: message };
      }
    },
  );
}

export function unregisterGoogleDocsHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.AUTH_STATUS);
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.AUTH_SIGN_IN);
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.AUTH_SIGN_OUT);
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.LINK);
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.UNLINK);
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.GET_LINK);
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.SYNC);
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.SYNC_CONFIRM_OVERWRITE);

  if (authChangeCleanup) {
    authChangeCleanup();
    authChangeCleanup = null;
  }
}
