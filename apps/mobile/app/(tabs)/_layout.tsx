import React from 'react';
import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { colors, type } from '../../src/theme';

function TabGlyph({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ color, fontSize: 16, fontFamily: type.mono }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: type.mono, fontSize: type.size.md },
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { fontFamily: type.mono, fontSize: type.size.xs },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Watchlist',
          tabBarIcon: ({ color }) => <TabGlyph glyph="≡" color={color} />,
        }}
      />
      <Tabs.Screen
        name="company"
        options={{
          title: 'Company',
          tabBarIcon: ({ color }) => <TabGlyph glyph="Σ" color={color} />,
        }}
      />
      <Tabs.Screen
        name="valuation"
        options={{
          title: 'Valuation',
          tabBarIcon: ({ color }) => <TabGlyph glyph="ƒ" color={color} />,
        }}
      />
      <Tabs.Screen
        name="checklist"
        options={{
          title: 'Checklist',
          tabBarIcon: ({ color }) => <TabGlyph glyph="✓" color={color} />,
        }}
      />
    </Tabs>
  );
}
