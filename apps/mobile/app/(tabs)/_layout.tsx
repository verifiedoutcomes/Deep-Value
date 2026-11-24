import React from 'react';
import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { colors, type } from '../../src/theme';
import { ChangeCompanyButton, CompanyHeaderTitle } from '../../src/components/CompanyHeader';

/** Per-company tabs name the selected company in their header. */
const companyHeader = (screen: string) => ({
  headerTitle: () => <CompanyHeaderTitle screen={screen} />,
  headerTitleAlign: 'left' as const,
  headerRight: () => <ChangeCompanyButton />,
});

function TabGlyph({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ color, fontSize: 16, fontFamily: type.mono }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg, borderBottomColor: colors.border },
        headerShadowVisible: false,
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
          ...companyHeader('Company'),
          tabBarIcon: ({ color }) => <TabGlyph glyph="Σ" color={color} />,
        }}
      />
      <Tabs.Screen
        name="valuation"
        options={{
          title: 'Valuation',
          ...companyHeader('Valuation'),
          tabBarIcon: ({ color }) => <TabGlyph glyph="ƒ" color={color} />,
        }}
      />
      <Tabs.Screen
        name="checklist"
        options={{
          title: 'Checklist',
          ...companyHeader('Checklist'),
          tabBarIcon: ({ color }) => <TabGlyph glyph="✓" color={color} />,
        }}
      />
    </Tabs>
  );
}
