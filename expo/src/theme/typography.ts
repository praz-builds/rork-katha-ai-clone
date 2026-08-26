import { TextStyle } from 'react-native';
import { fonts } from './theme';

export const type = {
  largeTitle: {
    fontSize: 34,
    fontFamily: fonts.display,
    fontWeight: '700' as const,
  },
  title: {
    fontSize: 24,
    fontFamily: fonts.display,
    fontWeight: '600' as const,
  },
  headline: {
    fontSize: 18,
    fontFamily: fonts.ui,
    fontWeight: '600' as const,
  },
  body: {
    fontSize: 16,
    fontFamily: fonts.ui,
    fontWeight: '400' as const,
  },
  subhead: {
    fontSize: 14,
    fontFamily: fonts.ui,
    fontWeight: '400' as const,
  },
  caption: {
    fontSize: 12,
    fontFamily: fonts.ui,
    fontWeight: '400' as const,
  },
  reader: {
    fontSize: 18,
    fontFamily: fonts.reader,
    fontWeight: '400' as const,
    lineHeight: 30,
  },
} as const satisfies Record<string, TextStyle>;
