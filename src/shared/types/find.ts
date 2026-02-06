export interface FindInPageOptions {
  matchCase?: boolean;
  forward?: boolean;
  findNext?: boolean;
}

export interface FindResult {
  activeMatchOrdinal: number;
  matches: number;
}
