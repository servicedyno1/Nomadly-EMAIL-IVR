import React from 'react';
import { PageHeader } from '../ui';
import { DncList } from './ai/DncList';

export default function DoNotCall() {
  return (
    <div data-testid="dnc-page">
      <PageHeader label="Calling" title="Do-not-call list" sub="No campaign ever calls these numbers — Bulk IVR or AI voice agent. People who ask an AI agent to stop calling are added automatically." testid="dnc-header" />
      <DncList />
    </div>
  );
}
