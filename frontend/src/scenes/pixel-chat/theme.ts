import { colorFromString, hslToRgb, luminance, mixColor, seedRng } from '../../shared/overlay';

/**
 * The scene ships in two skins: the colorful default and a Razer-green
 * variant. The theme is fixed for the lifetime of the page and is passed in
 * explicitly by each scene entry (see startPixelChat).
 */
export type PixelChatTheme = 'default' | 'razer';

export interface Palette {
  night: number;
  plate: number;
  plateDeep: number;
  ink: number;
  edge: number;
  line: number;
  flower: number;
  leaf: number;
  gold: number;
  blue: number;
  rose: number;
  violet: number;
}

const RAZER_BLACK = 0x000000;
const RAZER_DEEP = 0x020802;
const RAZER_DARK = 0x061906;
const RAZER_GREEN = 0x54f044;
const RAZER_TOXIC = 0x38ff24;
const RAZER_ACID = 0x8cff68;

export function makePalette(theme: PixelChatTheme, seed: number, userAccent: number): Palette {
  if (theme === 'razer') {
    const rng = seedRng(seed ^ 0x0badbabe);
    const toxic = mixColor(RAZER_TOXIC, RAZER_GREEN, rng() * 0.24);
    const acid = mixColor(RAZER_ACID, RAZER_TOXIC, rng() * 0.32);
    const plate = mixColor(RAZER_DARK, toxic, 0.22 + rng() * 0.14);
    const plateDeep = mixColor(RAZER_BLACK, RAZER_DEEP, 0.68);
    return {
      night: RAZER_BLACK,
      plate,
      plateDeep,
      ink: 0xf7fff4,
      edge: acid,
      line: toxic,
      flower: mixColor(acid, RAZER_GREEN, 0.38),
      leaf: RAZER_GREEN,
      gold: mixColor(RAZER_TOXIC, RAZER_ACID, 0.44),
      blue: mixColor(RAZER_DARK, RAZER_GREEN, 0.44),
      rose: mixColor(RAZER_TOXIC, 0xffffff, 0.08),
      violet: mixColor(RAZER_BLACK, RAZER_TOXIC, 0.30),
    };
  }

  const rng = seedRng(seed ^ 0x87ab3d1);
  const hue = Math.floor(rng() * 360);
  const plateHue = hue + [0, 34, 96, 148, 203, 276][seed % 6];
  const plate = mixColor(hslToRgb(plateHue, 0.62, 0.34), userAccent, 0.30);
  const plateDeep = mixColor(plate, 0x080712, 0.52);
  const line = hslToRgb(hue + 172, 0.88, 0.58);
  const rose = hslToRgb(hue + 314, 0.90, 0.58);
  const gold = hslToRgb(hue + 52, 0.92, 0.62);
  const blue = hslToRgb(hue + 202, 0.90, 0.60);
  const violet = hslToRgb(hue + 266, 0.80, 0.66);
  const leaf = hslToRgb(hue + 116, 0.72, 0.48);
  const night = mixColor(hslToRgb(hue + 238, 0.60, 0.11), 0x05030a, 0.52);
  const edge = mixColor(line, 0xffffff, 0.12);
  const flower = mixColor(rose, userAccent, 0.24);
  const ink = luminance(plate) > 0.45 ? 0x100915 : 0xfff7cf;

  return { night, plate, plateDeep, ink, edge, line, flower, leaf, gold, blue, rose, violet };
}

/** Color pools the TextilePlate ribbon pattern picks from, per theme. */
export function ribbonSchemes(theme: PixelChatTheme, palette: Palette, userAccent: number): number[][] {
  if (theme === 'razer') {
    return [
      [RAZER_BLACK, RAZER_DEEP, RAZER_DARK, RAZER_GREEN, RAZER_TOXIC, RAZER_ACID],
      [0x000000, 0x031003, 0x0a2608, 0x1fd816, 0x38ff24, 0x8cff68],
      [0x010401, 0x071807, 0x103b0c, 0x44d62c, 0x54f044, 0x9cff86],
      [mixColor(RAZER_BLACK, RAZER_GREEN, 0.18), RAZER_BLACK, RAZER_TOXIC, RAZER_DEEP, RAZER_ACID],
      [palette.night, palette.plateDeep, palette.plate, palette.line, palette.edge, palette.ink],
    ];
  }

  return [
    [0xcac2c2, 0x3f2d44, 0xffc0d8, 0xee73c8, 0x755d94],
    [0xb9cbb6, 0xf4c2b7, 0xe9958d, 0xd86fac, 0x8a4961],
    [0xe0e4eb, 0xb7c7d8, 0x72c7cf, 0x3b4459, 0x202226],
    [0x4d1418, 0x7f2418, 0xc45513, 0xf4bd42, 0xfff171],
    [0x8d6b7b, 0xcf65bd, 0xee79cb, 0xf3b5cf, 0xf7dfc4],
    [0xffdfe4, 0xffefe1, 0xd9f1df, 0x69bda7, 0x246b63, 0x82516a],
    [0xe2e4ff, 0xb88bd5, 0x8e7f8e, 0x4f515b, 0x30323a, 0x181b22],
    [0x00a7a7, 0x78f7e3, 0xfff5a3, 0xc8dc7a, 0x587451, 0x005f66],
    [0xec2f79, 0xff7ba7, 0xffc38b, 0xfff5b8, 0xf5f2ea, 0xbd2a59],
    [0x1f1646, 0x5c35b1, 0xb95dde, 0xff66c8, 0xf6a2d5, 0x85d8ff],
    [0x0b4f5f, 0x2ec4b6, 0xf6f7d7, 0xffb703, 0xfb8500, 0xd62828],
    [0x283618, 0x606c38, 0xdda15e, 0xfefae0, 0xbc6c25, 0x6f1d1b],
    [0x102542, 0x2b59c3, 0x7de2d1, 0xf7f6c5, 0xf26430, 0xa62639],
    [mixColor(palette.plate, 0xffffff, 0.28), mixColor(userAccent, 0xffffff, 0.18), palette.rose, palette.line, palette.violet],
  ];
}

/** Per-user accent color: chat color in the default theme, seeded green in razer. */
export function userAccentColor(
  theme: PixelChatTheme,
  userSeed: number,
  messageColor: string | undefined,
): number {
  if (theme === 'razer') {
    const rng = seedRng(userSeed ^ 0x44d62c);
    return mixColor(
      rng() > 0.5 ? RAZER_TOXIC : RAZER_GREEN,
      RAZER_ACID,
      0.18 + rng() * 0.32,
    );
  }
  const fallback = hslToRgb(userSeed % 360, 0.82, 0.58);
  return colorFromString(messageColor, fallback);
}
