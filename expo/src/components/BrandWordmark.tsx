import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { colors, fonts } from '@/theme';

type BrandWordmarkProps = {
  size?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export default function BrandWordmark({ size = 28, style, textStyle }: BrandWordmarkProps) {
  return (
    <View accessibilityRole="image" accessibilityLabel="Katha AI" style={[styles.row, style]}>
      <Text style={[styles.word, { fontSize: size, lineHeight: size * 1.04 }, textStyle]}>
        <Text style={styles.orange}>K</Text>
        <Text style={styles.ink}>atha</Text>
      </Text>
      <Text style={[styles.ai, { fontSize: size * 0.43, lineHeight: size * 0.52 }]}>AI</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline' },
  word: { fontFamily: fonts.brand, fontWeight: '900', letterSpacing: 0 },
  ai: { marginLeft: 2, fontFamily: fonts.brand, fontWeight: '900', letterSpacing: 0, color: colors.accent },
  orange: { color: colors.accent },
  ink: { color: colors.ink },
});
