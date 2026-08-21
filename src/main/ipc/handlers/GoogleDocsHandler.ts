import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/types/api';
import { getGoogleAuthService } from '@main/services/GoogleAuthService';
import { getGoogleDocsLinkStore } from '@main/services/GoogleDocsLinkStore';
import { createGoogleDocsService } from '@main/services/GoogleDocsService';
import { createGoogleDocsSyncService } from '@main/services/GoogleDocsSyncService';
import { getFileService } from '@main/services/FileService';
import type { TableColumnWidths, MermaidDiagramData, GoogleDocsSyncResult, SyncResolveMode, SyncDirection } from '@shared/types/google-docs';

function sendToAllWindows(channel: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

let authChangeCleanup: (() => void) | null = null;

/** A document the app can no longer reach: the link can never work again. */
function isGone(status: number | undefined): boolean {
  return status === 404 || status === 403;
}

export function registerGoogleDocsHandlers(): void {
  const authService = getGoogleAuthService();
  const linkStore = getGoogleDocsLinkStore();
  const docsService = createGoogleDocsService(() => authService.getAccessToken());

  /**
   * Forget a link whose document we can no longer reach -- typically one
   * carried over from the old paste-a-URL flow, which granted no per-file
   * access. Without this the button keeps offering a sync that can only fail.
   */
  const dropDeadLink = async (filePath: string): Promise<GoogleDocsSyncResult> => {
    await linkStore.removeLink(filePath);
    const error =
      'That Google Doc is no longer accessible. Link this file again to pick a document.';
    sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_STATUS, { syncing: false });
    return { success: false, error };
  };
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

  // Pick a doc through the Google Picker and link the file to it.
  // Picking is what grants this app drive.file access to that document, so
  // there is no way to link a document without going through it.
  ipcMain.handle(
    IPC_CHANNELS.GOOGLE_DOCS.PICK_AND_LINK,
    async (_event, filePath: string) => {
      const docId = await authService.pickDocument();
      if (!docId) return null; // user cancelled or picked nothing
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

  // Resolving takes two trips: 'preview' reports every difference, and
  // 'apply' carries back the markdown the user settled on.
  ipcMain.handle(
    IPC_CHANNELS.GOOGLE_DOCS.SYNC_RESOLVE,
    async (
      _event,
      filePath: string,
      mode: SyncResolveMode,
      direction: SyncDirection,
      markdownContent: string,
      mermaidDiagrams?: MermaidDiagramData[],
      tableWidths?: TableColumnWidths[],
    ) => {
      const link = linkStore.getLink(filePath);
      if (!link) return { success: false, error: 'File not linked to Google Docs' };
      sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_STATUS, { syncing: true });
      try {
        const result = await syncService.resolve(filePath, link.docId, mode, direction, markdownContent, {
          mermaidDiagrams,
          tableWidths,
          onProgress: (update) => sendToAllWindows(
            IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_PROGRESS, update,
          ),
          writeLocal: async (content) => {
            // Skip a write that would change nothing. Choosing "use my file"
            // for every difference leaves the markdown exactly as it was, and
            // rewriting it anyway would bump the mtime and wake the watcher
            // for no reason.
            const existing = await getFileService().readFile(filePath);
            if (existing.success && existing.content === content) return true;
            const written = await getFileService().writeFile(filePath, content);
            return written.success;
          },
        });
        if (!result.success && isGone(result.status)) {
          return await dropDeadLink(filePath);
        }
        sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_STATUS, { syncing: false });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Sync failed';
        console.error('Google Docs resolve error:', error);
        sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_STATUS, { syncing: false });
        // A deleted Doc surfaces either way -- thrown by the API client, or
        // caught and returned by the service. Both mean the link is dead.
        if (isGone((error as { status?: number }).status)) return await dropDeadLink(filePath);
        return { success: false, error: message };
      }
    },
  );
}

export function unregisterGoogleDocsHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.AUTH_STATUS);
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.AUTH_SIGN_IN);
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.AUTH_SIGN_OUT);
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.PICK_AND_LINK);
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.UNLINK);
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.GET_LINK);
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.SYNC_RESOLVE);

  if (authChangeCleanup) {
    authChangeCleanup();
    authChangeCleanup = null;
  }
}
