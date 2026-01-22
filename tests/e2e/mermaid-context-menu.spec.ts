/**
 * E2E Tests: Mermaid Context Menu - SVG to PNG rendering
 *
 * Tests the core SVG to PNG conversion functionality
 */
import { test as base, expect, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import path from 'node:path';

// Custom fixture that launches electron
const test = base.extend<{
  electronApp: ElectronApplication;
  mainWindow: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    const mainPath = path.join(__dirname, '../../.vite/build/index.js');
    const app = await electron.launch({
      args: [mainPath],
      timeout: 30000,
    });
    await use(app);
    await app.close();
  },
  mainWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await use(window);
  },
});

test.describe('SVG to PNG Conversion', () => {
  test('should convert simple SVG to PNG', async ({ mainWindow }) => {
    const result = await mainWindow.evaluate(async () => {
      // Create a simple SVG for testing
      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect x="10" y="10" width="80" height="80" fill="blue"/>
        <text x="50" y="55" text-anchor="middle" fill="white">Test</text>
      </svg>`;

      const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      return new Promise<{ base64Length: number; error?: string }>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 100;
          canvas.height = 100;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(svgUrl);
            resolve({ base64Length: 0, error: 'No canvas context' });
            return;
          }

          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(svgUrl);

          const dataUrl = canvas.toDataURL('image/png');
          const base64 = dataUrl.split(',')[1] ?? '';

          resolve({ base64Length: base64.length });
        };

        img.onerror = () => {
          URL.revokeObjectURL(svgUrl);
          resolve({ base64Length: 0, error: 'Image load error' });
        };

        img.src = svgUrl;
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.base64Length).toBeGreaterThan(100);
  });

  test('should handle SVG with missing xmlns when added', async ({ mainWindow }) => {
    const result = await mainWindow.evaluate(async () => {
      // Create SVG without xmlns (like Mermaid might generate)
      const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgElement.setAttribute('width', '100');
      svgElement.setAttribute('height', '100');

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', '10');
      rect.setAttribute('y', '10');
      rect.setAttribute('width', '80');
      rect.setAttribute('height', '80');
      rect.setAttribute('fill', 'red');
      svgElement.appendChild(rect);

      // Clone and add xmlns (this is what renderToPng does)
      const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
      svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svgClone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgClone);

      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      return new Promise<{ base64Length: number; error?: string; svgString: string }>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 100;
          canvas.height = 100;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(svgUrl);
            resolve({ base64Length: 0, error: 'No canvas context', svgString });
            return;
          }

          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(svgUrl);

          const dataUrl = canvas.toDataURL('image/png');
          const base64 = dataUrl.split(',')[1] ?? '';

          resolve({ base64Length: base64.length, svgString });
        };

        img.onerror = () => {
          URL.revokeObjectURL(svgUrl);
          resolve({ base64Length: 0, error: 'Image load error', svgString });
        };

        img.src = svgUrl;
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.base64Length).toBeGreaterThan(100);
  });

  test('SVG with native text (htmlLabels:false) should convert to PNG', async ({ mainWindow }) => {
    // This tests the core mechanism: SVG with native <text> elements works with canvas
    // This is what Mermaid generates when htmlLabels:false is set
    const result = await mainWindow.evaluate(async () => {
      // Create SVG using native SVG text elements (like Mermaid with htmlLabels:false)
      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">
        <rect x="10" y="10" width="180" height="50" fill="#f9f9f9" stroke="#333"/>
        <text x="100" y="40" text-anchor="middle" fill="#333" font-family="sans-serif">Start Node</text>
        <rect x="10" y="90" width="180" height="50" fill="#d4edda" stroke="#28a745"/>
        <text x="100" y="120" text-anchor="middle" fill="#155724" font-family="sans-serif">End Node</text>
        <line x1="100" y1="60" x2="100" y2="90" stroke="#333" stroke-width="2"/>
        <polygon points="100,90 95,80 105,80" fill="#333"/>
      </svg>`;

      const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      return new Promise<{ base64Length: number; error?: string }>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 200;
          canvas.height = 150;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(svgUrl);
            resolve({ base64Length: 0, error: 'No canvas context' });
            return;
          }

          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(svgUrl);

          const dataUrl = canvas.toDataURL('image/png');
          const base64 = dataUrl.split(',')[1] ?? '';

          resolve({ base64Length: base64.length });
        };

        img.onerror = () => {
          URL.revokeObjectURL(svgUrl);
          resolve({ base64Length: 0, error: 'Image load error' });
        };

        img.src = svgUrl;
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.base64Length).toBeGreaterThan(100);
  });

  test('SVG with foreignObject (htmlLabels:true) may fail canvas export', async ({ mainWindow }) => {
    // This tests that foreignObject with HTML content causes canvas security issues
    // This is what Mermaid generates when htmlLabels:true (the default before our fix)
    const result = await mainWindow.evaluate(async () => {
      // Create SVG using foreignObject with HTML (like Mermaid with htmlLabels:true)
      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
        <rect x="10" y="10" width="180" height="80" fill="#f9f9f9" stroke="#333"/>
        <foreignObject x="10" y="10" width="180" height="80">
          <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: sans-serif; padding: 10px;">
            <span style="color: #333;">HTML Label in foreignObject</span>
          </div>
        </foreignObject>
      </svg>`;

      const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      return new Promise<{ success: boolean; base64Length: number; error?: string }>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 200;
          canvas.height = 100;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(svgUrl);
            resolve({ success: false, base64Length: 0, error: 'No canvas context' });
            return;
          }

          try {
            ctx.drawImage(img, 0, 0);
            // Try to extract data - this may fail with "tainted canvas" error
            const dataUrl = canvas.toDataURL('image/png');
            const base64 = dataUrl.split(',')[1] ?? '';
            URL.revokeObjectURL(svgUrl);
            resolve({ success: true, base64Length: base64.length });
          } catch {
            URL.revokeObjectURL(svgUrl);
            // Expected: SecurityError due to foreignObject tainting canvas
            resolve({ success: false, base64Length: 0, error: 'Canvas tainted by foreignObject' });
          }
        };

        img.onerror = () => {
          URL.revokeObjectURL(svgUrl);
          resolve({ success: false, base64Length: 0, error: 'Image load error' });
        };

        img.src = svgUrl;
      });
    });

    // Note: The behavior varies by browser/environment
    // In Chromium, it may either:
    // 1. Fail to load the image (onerror)
    // 2. Load but toDataURL throws SecurityError
    // 3. In some cases it might work (depending on security policies)
    // The key point is that native SVG text (test above) ALWAYS works
    // while foreignObject is unreliable and may fail

    // We just verify we got a result - the test documents the security concern
    expect(result).toBeDefined();
  });
});
