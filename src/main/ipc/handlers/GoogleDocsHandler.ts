import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/types/api';
import { getGoogleAuthService } from '@main/services/GoogleAuthService';
import { getGoogleDocsLinkStore } from '@main/services/GoogleDocsLinkStore';
import { createGoogleDocsService } from '@main/services/GoogleDocsService';
import { createGoogleDocsSyncService } from '@main/services/GoogleDocsSyncService';
import type { TableColumnWidths, MermaidDiagramData, GoogleDocsSyncResult, SyncResolveMode, SyncConflictChoice } from '@shared/types/google-docs';

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

  // Sync
  ipcMain.handle(
    IPC_CHANNELS.GOOGLE_DOCS.SYNC,
    async (_event, filePath: string, markdownContent: string, mermaidDiagrams?: MermaidDiagramData[], tableWidths?: TableColumnWidths[]) => {
      try {
        console.warn('[SYNC] Starting sync for:', filePath);
        const link = linkStore.getLink(filePath);
        console.warn('[SYNC] Link:', link);
        if (!link) return { success: false, error: 'File not linked to Google Docs' };
        console.warn('[SYNC] Calling syncService.sync...');
        sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_STATUS, { syncing: true });
        const result = await syncService.sync(
          filePath,
          link.docId,
          markdownContent,
          mermaidDiagrams,
          tableWidths,
          (update) => sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_PROGRESS, update),
        );
        console.warn('[SYNC] Result:', JSON.stringify(result));

        // The sync service reports API failures rather than throwing, so an
        // unreachable document arrives here as a result, not an exception.
        if (!result.success && isGone(result.status)) {
          return await dropDeadLink(filePath);
        }

        sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_STATUS, { syncing: false });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : '';
        console.error('Google Docs sync error:', message, '\n', stack);

        // A document we cannot reach is a link that can never work again --
        // typically one carried over from the old paste-a-URL flow, which
        // granted no per-file access. Drop it so the next attempt picks a
        // document instead of retrying a doomed sync forever.
        if (isGone((error as { status?: number }).status)) {
          return await dropDeadLink(filePath);
        }

        sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_STATUS, { syncing: false });
        return { success: false, error: message };
      }
    },
  );

  // Reconcile a two-sided change the way the user chose. Merge takes two
  // trips: the first reports the blocks it cannot settle, the second carries
  // the user's answers.
  ipcMain.handle(
    IPC_CHANNELS.GOOGLE_DOCS.SYNC_RESOLVE,
    async (
      _event,
      filePath: string,
      mode: SyncResolveMode,
      markdownContent: string,
      mermaidDiagrams?: MermaidDiagramData[],
      tableWidths?: TableColumnWidths[],
      resolutions?: SyncConflictChoice[],
    ) => {
      const link = linkStore.getLink(filePath);
      if (!link) return { success: false, error: 'File not linked to Google Docs' };
      sendToAllWindows(IPC_CHANNELS.GOOGLE_DOCS.ON_SYNC_STATUS, { syncing: true });
      try {
        const result = await syncService.resolve(filePath, link.docId, mode, markdownContent, {
          mermaidDiagrams,
          tableWidths,
          resolutions,
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
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.SYNC);
  ipcMain.removeHandler(IPC_CHANNELS.GOOGLE_DOCS.SYNC_RESOLVE);

  if (authChangeCleanup) {
    authChangeCleanup();
    authChangeCleanup = null;
  }
}
