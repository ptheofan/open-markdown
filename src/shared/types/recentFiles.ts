export interface RecentFileEntry {
  filePath: string;
  fileName: string;
  openedAt: string; // ISO 8601
}

/** A folder opened in the sidebar */
export interface RecentFolderEntry {
  folderPath: string;
  folderName: string;
  openedAt: string; // ISO 8601
}
