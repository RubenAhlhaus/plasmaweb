/**
 * The machine's nine colours, applied to this UI's theme tokens.
 *
 * QtPlasmaC themes itself by string-replacing nine placeholders in a Qt stylesheet with the
 * colours from `[COLOR_OPTIONS]`. Porting the stylesheet would mean porting Qt widget
 * selectors, which mean nothing here; porting the *colours* is the part that matters, because
 * a shop that themed its table yellow-on-black should not find this screen blue.
 *
 * This UI's tokens are shadcn-style HSL triples (`--background: 220 20% 8%`), so each hex
 * colour is converted rather than pasted. Three colours have no existing token — the LED, the
 * estop red and the preview background — and get plasma-specific ones.
 */

export interface PlasmaColors {
  foreground: string;
  highlight: string;
  led: string;
  background: string;
  backgroundAlt: string;
  frames: string;
  estop: string;
  disabled: string;
  preview: string;
}

/** `#rrggbb` → `h s% l%`, the form this UI's CSS custom properties are written in. */
export function hexToHslTriple(hex: string): string | null {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;

  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  return `${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

/** Relative luminance, for deciding what text sits legibly on a colour. */
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})/i.exec(hex.trim());
  if (!match) return 0;
  const value = parseInt(match[1], 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Which of two colours reads better on `background`.
 *
 * QtPlasmaC pairs its colours by hand in the stylesheet — a button is foreground-on-background
 * one moment and the reverse when pressed. We cannot hand-pair a whole web UI against nine
 * arbitrary colours, so the one contrast decision that matters (text on a highlight) is made
 * by luminance instead of hoping.
 */
export function readableOn(background: string, light: string, dark: string): string {
  return luminance(background) > 0.4 ? dark : light;
}

/**
 * `{ cssVariable: value }` for one machine's colours.
 *
 * The mapping is a judgement about which of this UI's roles each QtPlasmaC colour plays:
 * `Frames` draws its panel borders, so it drives borders and inputs here; `Background Alt` is
 * its alternate surface, so it drives cards and muted panels; `Highlight` is what it makes
 * active controls, so it drives the primary colour and the focus ring.
 */
export function themeVariables(colors: PlasmaColors): Record<string, string> {
  const triple = (hex: string): string | null => hexToHslTriple(hex);
  const variables: Record<string, string> = {};

  const set = (name: string, hex: string) => {
    const value = triple(hex);
    if (value) variables[name] = value;
  };

  set('--background', colors.background);
  set('--foreground', colors.foreground);
  set('--card', colors.backgroundAlt);
  set('--card-foreground', colors.foreground);
  set('--secondary', colors.backgroundAlt);
  set('--secondary-foreground', colors.foreground);
  set('--muted', colors.backgroundAlt);
  set('--muted-foreground', colors.disabled);
  set('--accent', colors.backgroundAlt);
  set('--accent-foreground', colors.foreground);
  set('--primary', colors.highlight);
  set('--primary-foreground', readableOn(colors.highlight, colors.foreground, colors.background));
  set('--ring', colors.highlight);
  set('--border', colors.frames);
  set('--input', colors.frames);
  set('--destructive', colors.estop);
  set('--destructive-foreground', readableOn(colors.estop, colors.foreground, colors.background));

  // No existing token for these three; they are plasma's own and used directly as hex.
  variables['--plasma-led'] = colors.led;
  variables['--plasma-estop'] = colors.estop;
  variables['--plasma-preview'] = colors.preview;
  return variables;
}
