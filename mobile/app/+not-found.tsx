/** Fallback for unknown deep links (`spotlightstudio://nonsense`). */
import { useRouter } from 'expo-router';
import React from 'react';

import { EmptyState } from '../src/components/ui/States';

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <EmptyState
      icon="compass-outline"
      title="That link does not go anywhere"
      body="The wallpaper or page you asked for does not exist in this version of the app."
      actionLabel="Back to the gallery"
      onAction={() => router.replace('/')}
    />
  );
}
