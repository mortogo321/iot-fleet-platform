import { classNames } from '../lib/format';

export function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className={classNames('status-dot', online ? 'status-dot-online' : 'status-dot-offline')}
      title={online ? 'online' : 'offline'}
    />
  );
}
