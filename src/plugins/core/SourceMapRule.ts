import type MarkdownIt from 'markdown-it';

export function applySourceMapRule(md: MarkdownIt): void {
  md.core.ruler.push('source_map_attrs', (state) => {
    for (const token of state.tokens) {
      if (token.map && token.nesting === 1) {
        token.attrSet('data-source-lines', `${token.map[0]}-${token.map[1]}`);
      }
    }
  });

  const defaultFenceRender =
    md.renderer.rules.fence ||
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token?.map) {
      const attr = `data-source-lines="${token.map[0]}-${token.map[1]}"`;
      const rendered = defaultFenceRender(tokens, idx, options, env, self);
      return rendered.replace('<pre>', `<pre ${attr}>`);
    }
    return defaultFenceRender(tokens, idx, options, env, self);
  };
}
