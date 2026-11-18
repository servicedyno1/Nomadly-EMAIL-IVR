import React from 'react';
import { PageHeader } from '../ui';
import { DncList } from './ai/DncList';

export default function DoNotCall() {
  return (
    <div data-testid="dnc-page">
      <PageHeader label="Make calls" title="Do-not-call list" sub="No campaign ever calls these numbers. People who ask to stop are added automatically." testid="dnc-header" />
      <DncList />
    </div>
  );
}
