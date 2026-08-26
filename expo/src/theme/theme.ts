import type { Genre } from "@/types/domain";

export const colors = {
  bg: "#FAF7F2",
  canvas: "#F2EEE8",
  surface: "#FFFFFF",
  surface2: "#F5F0E9",
  border: "#EEE7DE",
  borderStrong: "#DED5C7",
  ink: "#0F0E0C",
  muted: "#6B6560",
  tertiary: "#9C9691",
  accent: "#FF6B1A",
  accentPressed: "#E85610",
  accentSoft: "#FFEFE2",
  heart: "#E85D5D",
  info: "#4A78C2",
  premium: "#C44536",
  success: "#12B5A5",
  sepia: "#F4E8D0",
  sepiaText: "#4A3B2A",
  sepiaHeading: "#33291f",
  sepiaBody: "#4a3f35",
  sepiaMuted: "#8b7d6b",
  sepiaSecondary: "#6a5c4c",
  sepiaAccent: "#A64C1C",
  sepiaButton: "#ec6f2c",
  sepiaPlaceholder: "#e7dcc6",
  sepiaToggleTrack: "#e7ddca"
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999
} as const;

export const fonts = {
  display: "BricolageGrotesque",
  ui: "HankenGrotesk",
  brand: "Baloo2",
  reader: "Literata",
  readerItalic: "LiterataItalic"
} as const;

export const genreLabels: Record<Genre, string> = {
  romance: "Romance",
  romantasy: "Romantasy",
  darkRomance: "Dark Romance",
  fantasy: "Fantasy",
  scifi: "Sci-Fi",
  thriller: "Thriller",
  mystery: "Mystery",
  horror: "Horror",
  contemporary: "Contemporary",
  historical: "Historical",
  adventure: "Adventure",
  comedy: "Comedy",
  poetry: "Poetry",
};

export const genreGradients: Record<Genre, readonly [string, string, string]> = {
  romance: ["#C45B7B", "#8B2D4B", "#5A1D33"],
  romantasy: ["#8E5BAA", "#5B2D7B", "#3A1D55"],
  darkRomance: ["#8B1A1A", "#5A0D0D", "#2A0505"],
  fantasy: ["#5B8A5B", "#3A6B3A", "#1A4A2A"],
  scifi: ["#4A3A8E", "#2D1A5A", "#1A0D3A"],
  thriller: ["#3A3A3A", "#1A1A1A", "#0D0D0D"],
  mystery: ["#2C3E50", "#1A2A36", "#0D1620"],
  horror: ["#5A1D1D", "#3A0D0D", "#1A0505"],
  contemporary: ["#4A9A9A", "#2D6B6B", "#1A4A4A"],
  historical: ["#8B7355", "#6B5235", "#3A2D1A"],
  adventure: ["#E87B4A", "#C04A2D", "#8B2A1A"],
  comedy: ["#F0C04A", "#D4A02D", "#8B7020"],
  poetry: ["#8E7A9E", "#6B5B8E", "#4A3A6B"],
};
