import React from 'react';

/**
 * PanelEmptyState — friendly, consistent empty state for HostPanel tabs.
 * Icon + heading + description, with an optional primary CTA that fires the
 * relevant "create/add" action so a fresh account is never a dead end.
 */
export default function PanelEmptyState({ icon, title, description, actionLabel, onAction, testId }) {
  return (
    <div className="panel-empty" data-testid={testId || 'panel-empty-state'}>
      {icon && <div className="panel-empty__icon" aria-hidden="true">{icon}</div>}
      {title && <h3 className="panel-empty__title">{title}</h3>}
      {description && <p className="panel-empty__desc">{description}</p>}
      {actionLabel && onAction && (
        <button
          type="button"
          className="fm-btn fm-btn--primary panel-empty__cta"
          onClick={onAction}
          data-testid={`${testId || 'panel-empty'}-cta`}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
