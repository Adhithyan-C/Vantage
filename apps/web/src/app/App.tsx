import React from 'react';
import { SOURCE_IDS } from '@vantage/shared';

export function App() {
  return (
    <div>
      <h1>Vantage</h1>
      <p>Phase 1 scaffold</p>
      <p>Sources configured: {SOURCE_IDS.join(', ')}</p>
    </div>
  );
}
