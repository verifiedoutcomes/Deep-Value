import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, space, type } from '../theme';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Mono({
  children,
  size = 'md',
  color = colors.text,
  bold = false,
  lines,
}: {
  children: React.ReactNode;
  size?: keyof typeof type.size;
  color?: string;
  bold?: boolean;
  /** Truncate with an ellipsis after this many lines. */
  lines?: number;
}) {
  return (
    <Text
      numberOfLines={lines}
      style={{
        fontFamily: type.mono,
        fontSize: type.size[size],
        color,
        fontWeight: bold ? '700' : '400',
        fontVariant: ['tabular-nums'],
      }}
    >
      {children}
    </Text>
  );
}

export function KV({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.kvRow}>
      <Mono size="sm" color={colors.textDim}>
        {label}
      </Mono>
      <Mono size="sm" color={valueColor ?? colors.text} bold>
        {value}
      </Mono>
    </View>
  );
}

export function Chip({
  label,
  active = false,
  onPress,
  tone = 'neutral',
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  tone?: 'neutral' | 'good' | 'bad';
}) {
  const toneColor =
    tone === 'good' ? colors.accent : tone === 'bad' ? colors.red : colors.textDim;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        active && { borderColor: toneColor, backgroundColor: colors.surfaceAlt },
      ]}
    >
      <Mono size="xs" color={active ? toneColor : colors.textDim} bold={active}>
        {label}
      </Mono>
    </Pressable>
  );
}

export function Banner({
  children,
  tone = 'info',
  action,
}: {
  children: React.ReactNode;
  tone?: 'info' | 'warn';
  /** Optional tappable action at the right edge (e.g. refresh on web). */
  action?: { label: string; onPress: () => void; disabled?: boolean };
}) {
  return (
    <View
      style={[
        styles.banner,
        { borderColor: tone === 'warn' ? colors.amber : colors.blueDim },
        action && styles.bannerWithAction,
      ]}
    >
      <Text
        style={{ color: colors.textDim, fontSize: type.size.sm, fontFamily: type.mono, flex: 1 }}
      >
        {children}
      </Text>
      {action && (
        <Pressable
          onPress={action.onPress}
          disabled={action.disabled}
          hitSlop={8}
          accessibilityRole="button"
          style={[styles.bannerAction, action.disabled && { opacity: 0.5 }]}
        >
          <Mono size="sm" color={colors.accent} bold>{action.label}</Mono>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    padding: space.md,
    marginHorizontal: space.md,
    marginTop: space.md,
  },
  sectionTitle: {
    color: colors.textFaint,
    fontFamily: type.mono,
    fontSize: type.size.xs,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: space.sm,
  },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    marginRight: space.xs,
    backgroundColor: colors.chipBg,
  },
  bannerWithAction: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  bannerAction: {
    borderColor: colors.accentDim,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
  },
  banner: {
    borderWidth: 1,
    borderRadius: 4,
    padding: space.sm,
    marginHorizontal: space.md,
    marginTop: space.md,
    backgroundColor: colors.surfaceAlt,
  },
});
