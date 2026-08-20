import { classNames } from '../lib/format';
import type { WsStatus } from '../lib/ws';

const LABELS: Record<WsStatus, string> = {
  open: 'live',
  connecting: 'connecting',
  reconnecting: 'reconnecting',
};

export function ConnectionBadge({ status }: { status: WsStatus }) {
  return (
    <span className={classNames('connection-badge', `connection-badge-${status}`)}>
      <span className="connection-badge-dot" />
      {LABELS[status]}
    </span>
  );
}
