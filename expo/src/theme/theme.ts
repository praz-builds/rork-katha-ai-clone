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
  sepiaText: "#4A3B2A"
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
  adventure: "Adventure",
  comedy: "Comedy",
  contemporary: "Contemporary",
  drama: "Drama",
  fantasy: "Fantasy",
  historical: "Historical",
  horror: "Horror",
  kids: "Kids",
  lgbtq: "LGBTQ+",
  motivational: "Motivational",
  mystery: "Mystery",
  mythology: "Mythology",
  poetry: "Poetry",
  romance: "Romance",
  scifi: "Sci-Fi",
  sliceOfLife: "Slice of life",
  spirituality: "Spirituality",
  thriller: "Thriller"
};

export const genreGradients: Record<Genre, readonly [string, string, string]> = {
  adventure: ["#E87B4A", "#C04A2D", "#8B2A1A"],
  comedy: ["#F0C04A", "#D4A02D", "#8B7020"],
  contemporary: ["#4A9A9A", "#2D6B6B", "#1A4A4A"],
  drama: ["#6B4A6B", "#4A2D4A", "#2A1A2A"],
  fantasy: ["#5B8A5B", "#3A6B3A", "#1A4A2A"],
  historical: ["#8B7355", "#6B5235", "#3A2D1A"],
  horror: ["#5A1D1D", "#3A0D0D", "#1A0505"],
  kids: ["#FFB347", "#FF8C42", "#CC6A2D"],
  lgbtq: ["#E84A7B", "#C42D5B", "#8B1D3D"],
  motivational: ["#E8B83D", "#C8982A", "#8B6B1A"],
  mystery: ["#2C3E50", "#1A2A36", "#0D1620"],
  mythology: ["#B85A2D", "#8B3A1A", "#5A1D0D"],
  poetry: ["#8E7A9E", "#6B5B8E", "#4A3A6B"],
  romance: ["#C45B7B", "#8B2D4B", "#5A1D33"],
  scifi: ["#4A3A8E", "#2D1A5A", "#1A0D3A"],
  sliceOfLife: ["#D4A574", "#A67B52", "#6B4F35"],
  spirituality: ["#6B8E6B", "#4A6B4A", "#2A4A2A"],
  thriller: ["#3A3A3A", "#1A1A1A", "#0D0D0D"]
};
